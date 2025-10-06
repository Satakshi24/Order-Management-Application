// server.js
// Express + Prisma (PostgreSQL) + Redis caching (Upstash-compatible)

const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('redis');

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3000;
const FRONTEND = process.env.FRONTEND_URL;   // e.g. https://order-management-application-alpha.vercel.app
const REDIS_URL = process.env.REDIS_URL;     // e.g. rediss://:PASSWORD@HOST:PORT

// -----------------------------
// Middleware
// -----------------------------
app.use(express.json());

// CORS: during debugging you can use `app.use(cors())`.
// Once working, prefer the allow-list below:
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
  // Fall back to permissive CORS if FRONTEND_URL isn't set
  console.warn('[cors] FRONTEND_URL not set — using permissive CORS for now');
  app.use(cors());
}

// -----------------------------
// Redis (guarded; won’t crash app if unavailable)
// -----------------------------
let redisClient = null;
let redisReady = false;

if (REDIS_URL) {
  redisClient = createClient({
    url: REDIS_URL,                         // Upstash recommended: rediss://…
    socket: { tls: REDIS_URL.startsWith('rediss://'), rejectUnauthorized: false },
  });
  redisClient.on('error', (e) => console.error('[redis] error:', e));
  redisClient.connect()
    .then(() => { redisReady = true; console.log('[redis] ready'); })
    .catch((e) => console.error('[redis] connect failed:', e));
} else {
  console.warn('[redis] REDIS_URL not set; caching disabled');
}

// -----------------------------
// Cache helpers (versioned keys → cheap invalidation)
// -----------------------------
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

// -----------------------------
// Health check
// -----------------------------
app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ping = (redisClient && redisReady) ? await redisClient.ping() : 'disabled';
    res.json({ ok: true, redis: ping });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// -----------------------------
// GET /orders  (with Redis cache)
// ?page=1&limit=5&search=foo
// -----------------------------
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

    // Prisma relation filter (note the `is: { ... }` for a 1:1/required relation)
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

// -----------------------------
// POST /orders  (transaction + stock checks + cache invalidation)
// Body: { userId: <id>, items: [{ productId, quantity }] }
// -----------------------------
app.post('/orders', async (req, res) => {
  try {
    const { userId, items } = req.body || {};
    if (!userId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'userId and items required' });
    }

    // Ensure user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Load products
    const productIds = items.map(i => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== items.length) {
      return res.status(404).json({ error: 'Some products not found' });
    }

    // Validate stock & compute total using DB prices (never trust FE price)
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

    // Transaction: create order + decrement stock
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

      // Decrement stock for each item
      for (const i of items) {
        await tx.product.update({
          where: { id: i.productId },
          data: { stock: { decrement: Number(i.quantity) } },
        });
      }

      return created;
    });

    // Invalidate cached lists (version bump)
    await bumpOrdersVer();

    // Mock async queue (simulates SQS/email/etc.)
    console.log('📬 Queue: confirm_order', { orderId: order.id, userEmail: user.email, total: order.total });

    res.status(201).json(order);
  } catch (error) {
    console.error('POST /orders failed:', error);
    // P2003 etc. will show up in detail; you can map codes to nicer messages if you want
    res.status(500).json({ error: 'INTERNAL', detail: String(error) });
  }
});

// -----------------------------
// Simple pass-through endpoints
// -----------------------------
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

// -----------------------------
// Process guards & start
// -----------------------------
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
