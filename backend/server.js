const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('redis');

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3000;
const FRONTEND = process.env.FRONTEND_URL;
const REDIS_URL = process.env.REDIS_URL;

app.use(express.json());
if (FRONTEND) {
  const allowed = [FRONTEND];
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowed.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
} else {
  console.warn('[cors] FRONTEND_URL not set — using permissive CORS for now');
  app.use(cors());
}

let redisClient = null;
let redisReady = false;

if (REDIS_URL) {
  redisClient = createClient({
    url: REDIS_URL,                      
    socket: { tls: REDIS_URL.startsWith('rediss://'), rejectUnauthorized: false },
  });
  redisClient.on('error', (e) => console.error('[redis] error:', e));
  redisClient.connect()
    .then(() => { redisReady = true; console.log('[redis] ready'); })
    .catch((e) => console.error('[redis] connect failed:', e));
} else {
  console.warn('[redis] REDIS_URL not set; caching disabled');
}

let ORDERS_VER = 1;

async function getOrdersVer() {
  if (redisClient && redisReady) {
    const v = await redisClient.get('orders:ver');
    if (v) ORDERS_VER = Number(v);
  }
  return ORDERS_VER;
}
async function bumpOrdersVer() {
  ORDERS_VER += 1;
  if (redisClient && redisReady) {
    await redisClient.set('orders:ver', String(ORDERS_VER));
  }
}
function buildOrdersKey({ page, limit, search, ver }) {
  return `orders:v${ver}:page=${page}&limit=${limit}&search=${search || ''}`;
}

app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ping = (redisClient && redisReady) ? await redisClient.ping() : 'disabled';
    res.json({ ok: true, redis: ping });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/orders', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.max(1, parseInt(req.query.limit || '10', 10));
    const search = String(req.query.search || '');
    const skip = (page - 1) * limit;

    const ver = await getOrdersVer();
    const cacheKey = buildOrdersKey({ page, limit, search, ver });

    if (redisClient && redisReady) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        console.log('✨ Cache HIT');
        return res.json(JSON.parse(cached));
      }
    }
    console.log('💾 Cache MISS');

    const where = search
      ? { user: { is: { OR: [
            { name:  { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
        ] } } }
      : {};

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: true,
          orderItems: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ]);

    const payload = {
      data: orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };

    if (redisClient && redisReady) {
      await redisClient.setEx(cacheKey, 30, JSON.stringify(payload)); // 30s TTL
    }

    res.json(payload);
  } catch (error) {
    console.error('GET /orders failed:', error);
    res.status(500).json({ error: 'INTERNAL', detail: String(error) });
  }
});

app.post('/orders', async (req, res) => {
  try {
    const { userId, items } = req.body || {};
    if (!userId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'userId and items required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const productIds = items.map(i => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== items.length) {
      return res.status(404).json({ error: 'Some products not found' });
    }

    let total = 0;
    const orderItemsData = [];
    for (const item of items) {
      const product = products.find(p => p.id === item.productId);
      if (!product) return res.status(404).json({ error: `Product ${item.productId} not found` });

      const q = Number(item.quantity || 0);
      if (q < 1) return res.status(400).json({ error: `Invalid quantity for product ${product.id}` });
      if (product.stock < q) {
        return res.status(400).json({ error: `Not enough stock for ${product.name}. Available: ${product.stock}` });
      }

      total += product.price * q;
      orderItemsData.push({ productId: product.id, quantity: q, price: product.price });
    }

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId,
          total,
          orderItems: { create: orderItemsData },
        },
        include: {
          user: true,
          orderItems: { include: { product: true } },
        },
      });


      for (const i of items) {
        await tx.product.update({
          where: { id: i.productId },
          data: { stock: { decrement: Number(i.quantity) } },
        });
      }

      return created;
    });

    await bumpOrdersVer();


    console.log('📬 Queue: confirm_order', { orderId: order.id, userEmail: user.email, total: order.total });

    res.status(201).json(order);
  } catch (error) {
    console.error('POST /orders failed:', error);
    res.status(500).json({ error: 'INTERNAL', detail: String(error) });
  }
});

app.get('/users', async (_req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/products', async (_req, res) => {
  try {
    const products = await prisma.product.findMany();
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

process.on('SIGINT', async () => {
  try { await prisma.$disconnect(); } catch {}
  try { if (redisClient) await redisClient.quit(); } catch {}
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 API listening on :${PORT}`);
});
