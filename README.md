# 📦 Order Management System

A full-stack order management application built with modern technologies including Prisma ORM, PostgreSQL, Redis caching, and a mock SQS queue system.

## 🔗 Live Demo

- **Frontend**: [https://order-management-application-alpha.vercel.app/]
- **Backend**: [https://order-management-application-zq24.onrender.com]
- **GitHub**: [https://github.com/Satakshi24/Order-Management-Application]

## 🛠️ Tech Stack

### Backend
- **Node.js** with Express.js
- **Prisma ORM** for database operations
- **PostgreSQL** for data persistence
- **Redis** for caching (30-second TTL)
- **Mock Queue** simulating AWS SQS for async processing

### Frontend
- **React** (Create React App)
- **JavaScript** (ES6+)
- **CSS3** for styling

## ✨ Features

- ✅ Create orders with multiple products
- ✅ View all orders with pagination
- ✅ Search orders by user name or email
- ✅ Redis caching for improved performance
- ✅ Cache invalidation on order creation
- ✅ Database transactions for data consistency
- ✅ Async order confirmation via mock queue
- ✅ Stock management with validation
- ✅ Responsive UI design

## 🏗️ Architecture

```
Frontend (React) → Backend API (Express) → Database (PostgreSQL)
                         ↓
                    Redis Cache
                         ↓
                  Queue (Mock SQS)
```

## 📊 Database Schema

- **User**: Customer information (id, email, name)
- **Product**: Available products (id, name, price, stock)
- **Order**: Customer orders (id, userId, status, total)
- **OrderItem**: Products in each order (id, orderId, productId, quantity, price)

## 🚀 Local Setup

### Prerequisites

- Node.js 18+ installed
- PostgreSQL database (local or cloud)
- Redis instance (local or cloud)

### Backend Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Satakshi24/Order-management.git
   cd Order-management/backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create `.env` file**
   ```bash
   DATABASE_URL="postgresql://user:password@localhost:5432/order_db"
   REDIS_URL="redis://localhost:6379"
   PORT=3000
   FRONTEND_URL="http://localhost:3001"
   ```

4. **Setup database**
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   npx prisma db seed
   ```

5. **Start backend**
   ```bash
   npm start
   ```

   Backend runs at `http://localhost:3000`

### Frontend Setup

1. **Navigate to frontend**
   ```bash
   cd ../frontend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start frontend**
   ```bash
   npm start
   ```

   Frontend opens at `http://localhost:3001`

## 🐳 Using Docker (Optional)

```bash
# Start PostgreSQL
docker run --name postgres -e POSTGRES_PASSWORD=password -p 5432:5432 -d postgres

# Start Redis
docker run --name redis -p 6379:6379 -d redis
```

## 🌐 Deployment

### Backend (Render)

1. Create PostgreSQL database on Render
2. Create new Web Service
3. Connect GitHub repository
4. Set environment variables:
   - `DATABASE_URL` (from Render PostgreSQL)
   - `REDIS_URL` (from Upstash)
   - `PORT=3000`
   - `FRONTEND_URL` (your Vercel URL)
5. Deploy!

### Redis (Upstash)

1. Create account at [Upstash](https://upstash.com)
2. Create new Redis database
3. Copy connection URL
4. Add to Render environment variables

### Frontend (Vercel)

1. Import repository to Vercel
2. Set root directory to `frontend`
3. Add environment variable:
   - `REACT_APP_API_URL` (your Render backend URL)
4. Deploy!

## 🔑 API Endpoints

### GET /orders
Get all orders with pagination and search

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `search` (optional): Search by user name or email

**Example:**
```
GET /orders?page=1&limit=10&search=john
```

**Response:**
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "totalPages": 5
  }
}
```

### POST /orders
Create a new order

**Request Body:**
```json
{
  "userId": "user-uuid",
  "items": [
    {
      "productId": "product-uuid",
      "quantity": 2
    }
  ]
}
```

**Response:**
```json
{
  "id": "order-uuid",
  "userId": "user-uuid",
  "total": 1999.98,
  "status": "pending",
  "orderItems": [...]
}
```

### GET /users
Get all users

### GET /products
Get all products

## 🎯 Key Implementation Details

### Redis Caching
- GET requests are cached for 30 seconds
- Cache is automatically invalidated when new orders are created
- Reduces database load and improves response time

### Database Transactions
- Order creation and stock updates happen atomically
- If any operation fails, all changes are rolled back
- Ensures data consistency

### Mock Queue
- Simulates AWS SQS for asynchronous processing
- Order confirmations are processed in the background
- Provides faster API responses

## 🔄 Data Flow

### Creating an Order:
1. User submits order form
2. Backend validates user and products
3. Checks product stock availability
4. **Transaction begins:**
   - Create order record
   - Create order items
   - Decrease product stock
5. **Transaction commits**
6. Cache invalidation (clear cached orders)
7. Queue order confirmation job
8. Return success response

### Viewing Orders:
1. Check Redis cache
2. **Cache hit:** Return cached data (fast!)
3. **Cache miss:** Query database
4. Store result in cache (30s TTL)
5. Return data

## 🛡️ Trade-offs & Design Decisions

### What I Did:
- ✅ Used mock queue instead of real AWS SQS (simpler for demo)
- ✅ Simple authentication (no login system for demo purposes)
- ✅ In-memory queue instead of persistent queue
- ✅ Basic error handling (production would need more robust handling)

### What I Would Add in Production:
- 🔐 JWT-based authentication
- 🔒 Role-based authorization
- 📧 Real email notifications
- 🧪 Comprehensive testing (unit, integration, E2E)
- 📊 Logging and monitoring (Winston, DataDog)
- 🚦 Rate limiting
- 🔄 Proper queue with Redis Bull or AWS SQS
- 📝 API documentation (Swagger)

## 🐛 Troubleshooting

### Backend won't start
- Check PostgreSQL is running
- Check Redis is running
- Verify `.env` has correct URLs
- Run `npx prisma generate`

### Frontend can't connect to backend
- Check backend is running
- Verify `REACT_APP_API_URL` is correct
- Check CORS settings

### Database errors
- Run `npx prisma migrate dev`
- Check `DATABASE_URL` format
- Verify database exists

## 📝 Scripts

### Backend
```bash
npm start          # Start server
npx prisma studio  # Open database GUI
npx prisma migrate dev  # Run migrations
npx prisma db seed      # Seed database
```

### Frontend
```bash
npm start   # Start dev server
npm build   # Build for production
```

## 👨‍💻 Author

**Satakshi**
- GitHub: [@Satakshi24](https://github.com/Satakshi24)

## 📄 License

MIT

---

**Note:** This is a demonstration project. For production use, additional security measures, testing, and monitoring would be required.