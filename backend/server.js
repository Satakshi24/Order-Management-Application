// UPGRADED: SQLite → Prisma + PostgreSQL + Redis
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Prisma (replaces SQLite)
const prisma = new PrismaClient();

// Setup Redis (NEW - for caching)
let redisClient;
(async () => {
  redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      tls: true,              // ADD THIS LINE
      rejectUnauthorized: false  // ADD THIS LINE
    }
  });
  
  redisClient.on('error', (err) => console.log('Redis error:', err));
  await redisClient.connect();
  console.log('✅ Redis connected');
})();

app.use(express.json());
app.use(cors());

// Mock Queue (NEW - simulates SQS)
function addToQueue(jobType, data) {
  console.log(`📬 Queue: ${jobType}`, data);
  setTimeout(() => {
    console.log(`✅ Processed: ${jobType} for order ${data.orderId}`);
  }, 2000);
}

// ==========================================
// GET /orders - WITH REDIS CACHING
// ==========================================
app.get('/orders', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    // Cache key
    const cacheKey = `orders:page:${page}:limit:${limit}:search:${search}`;

    // Check Redis cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log('✨ Cache HIT - returning from Redis');
      return res.json(JSON.parse(cached));
    }

    console.log('💾 Cache MISS - fetching from database');

    // Build search filter
    const where = search ? {
      user: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ]
      }
    } : {};

    // Fetch from database (Prisma replaces raw SQL)
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: true,
          orderItems: {
            include: { product: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.order.count({ where })
    ]);

    const response = {
      data: orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };

    // Cache for 30 seconds
    await redis.setEx(cacheKey, 30, JSON.stringify(response));
    console.log('💾 Cached for 30 seconds');

    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// POST /orders - WITH TRANSACTION
// ==========================================
app.post('/orders', async (req, res) => {
  try {
    const { userId, items } = req.body;

    if (!userId || !items || items.length === 0) {
      return res.status(400).json({ error: 'userId and items required' });
    }

    // Check user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get products
    const productIds = items.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } }
    });

    if (products.length !== items.length) {
      return res.status(404).json({ error: 'Some products not found' });
    }

    // Calculate total & validate stock
    let total = 0;
    const orderItemsData = [];

    for (const item of items) {
      const product = products.find(p => p.id === item.productId);
      
      if (product.stock < item.quantity) {
        return res.status(400).json({
          error: `Not enough stock for ${product.name}. Available: ${product.stock}`
        });
      }

      total += product.price * item.quantity;
      orderItemsData.push({
        productId: product.id,
        quantity: item.quantity,
        price: product.price
      });
    }

    // TRANSACTION - All succeed or all fail
    const order = await prisma.$transaction(async (tx) => {
      // Create order
      const newOrder = await tx.order.create({
        data: {
          userId,
          total,
          orderItems: { create: orderItemsData }
        },
        include: {
          user: true,
          orderItems: { include: { product: true } }
        }
      });

      // Update stock
      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } }
        });
      }

      return newOrder;
    });

    // CACHE INVALIDATION - Clear all cached orders
    const keys = await redis.keys('orders:*');
    if (keys.length > 0) {
      await redis.del(keys);
      console.log('🗑️ Cache invalidated');
    }

    // QUEUE - Add async job
    addToQueue('confirm_order', {
      orderId: order.id,
      userEmail: user.email,
      total: order.total
    });

    res.status(201).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET /users
app.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /products
app.get('/products', async (req, res) => {
  try {
    const products = await prisma.product.findMany();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log('📊 Endpoints: GET/POST /orders, GET /users, GET /products\n');
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  await redis.quit();
  process.exit();
});