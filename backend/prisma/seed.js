const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create users
  const user1 = await prisma.user.create({
    data: { email: 'john@example.com', name: 'John Doe' }
  });

  const user2 = await prisma.user.create({
    data: { email: 'jane@example.com', name: 'Jane Smith' }
  });

  console.log('✅ Created users');

  // Create products
  await prisma.product.createMany({
    data: [
      { name: 'Laptop', price: 999.99, stock: 10 },
      { name: 'Mouse', price: 29.99, stock: 50 },
      { name: 'Keyboard', price: 79.99, stock: 30 },
      { name: 'Monitor', price: 299.99, stock: 15 }
    ]
  });

  console.log('✅ Created products');
  console.log('🎉 Seeding complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());