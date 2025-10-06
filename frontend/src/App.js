import React, { useState, useEffect } from 'react';
import './App.css';

const API_URL = 'http://localhost:3000';

function App() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchOrders();
  }, [page, search]);

  function fetchOrders() {
    setLoading(true);
    let url = `${API_URL}/orders?page=${page}&limit=5`;
    if (search) url += `&search=${search}`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        setOrders(data.data);
        setTotalPages(data.pagination.totalPages);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        alert('Failed to load orders. Is backend running?');
        setLoading(false);
      });
  }

  function handleSearch(e) {
    setSearch(e.target.value);
    setPage(1);
  }

  function handleOrderCreated() {
    setShowForm(false);
    setPage(1);
    fetchOrders();
  }

  return (
    <div className="App">
      <header className="header">
        <h1>📦 Order Management System</h1>
      </header>

      <div className="container">
        <div className="top-section">
          <h2>All Orders</h2>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            {showForm ? 'Cancel' : '+ Create Order'}
          </button>
        </div>

        {showForm && <CreateOrderForm onSuccess={handleOrderCreated} />}

        <div className="search-box">
          <input
            type="text"
            placeholder="Search by user name..."
            value={search}
            onChange={handleSearch}
          />
        </div>

        {loading ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        ) : (
          <>
            <OrderList orders={orders} />
            {totalPages > 1 && (
              <div className="pagination">
                <button onClick={() => setPage(page - 1)} disabled={page === 1} className="btn-secondary">
                  ← Previous
                </button>
                <span>Page {page} of {totalPages}</span>
                <button onClick={() => setPage(page + 1)} disabled={page === totalPages} className="btn-secondary">
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OrderList({ orders }) {
  if (orders.length === 0) {
    return (
      <div className="no-orders">
        <p>📭 No orders found</p>
      </div>
    );
  }

  return (
    <div className="orders-list">
      {orders.map(order => (
        <div key={order.id} className="order-card">
          <div className="order-header">
            <div>
              <h3>Order #{order.id}</h3>
              <p className="user-name">👤 {order.user_name}</p>
              <p className="date">📅 {new Date(order.created_at).toLocaleDateString()}</p>
            </div>
            <div className="order-right">
              <span className={`status ${order.status}`}>{order.status.toUpperCase()}</span>
              <p className="total">${order.total.toFixed(2)}</p>
            </div>
          </div>
          <div className="order-items">
            <strong>Items:</strong>
            {order.items && order.items.map(item => (
              <div key={item.id} className="item">
                <span>{item.product_name} × {item.quantity}</span>
                <span>${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateOrderForm({ onSuccess }) {
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedItems, setSelectedItems] = useState([{ productId: '', quantity: 1 }]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/users`).then(res => res.json()).then(setUsers);
    fetch(`${API_URL}/products`).then(res => res.json()).then(setProducts);
  }, []);

  function addItem() {
    setSelectedItems([...selectedItems, { productId: '', quantity: 1 }]);
  }

  function removeItem(index) {
    setSelectedItems(selectedItems.filter((_, i) => i !== index));
  }

  function updateItem(index, field, value) {
    const newItems = [...selectedItems];
    newItems[index][field] = value;
    setSelectedItems(newItems);
  }

  function calculateTotal() {
    let total = 0;
    selectedItems.forEach(item => {
      if (item.productId) {
        const product = products.find(p => p.id === parseInt(item.productId));
        if (product) total += product.price * item.quantity;
      }
    });
    return total;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!selectedUserId) {
      alert('Please select a user');
      return;
    }

    const validItems = selectedItems.filter(item => item.productId && item.quantity > 0);
    if (validItems.length === 0) {
      alert('Please add at least one product');
      return;
    }

    setLoading(true);
    fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: parseInt(selectedUserId),
        items: validItems.map(item => ({
          productId: parseInt(item.productId),
          quantity: parseInt(item.quantity)
        }))
      })
    })
      .then(res => {
        if (!res.ok) return res.json().then(err => { throw new Error(err.error); });
        return res.json();
      })
      .then(() => {
        alert('✅ Order created!');
        onSuccess();
      })
      .catch(err => alert('❌ Error: ' + err.message))
      .finally(() => setLoading(false));
  }

  return (
    <form onSubmit={handleSubmit} className="create-form">
      <h3>Create New Order</h3>

      <div className="form-group">
        <label>Select User *</label>
        <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} required>
          <option value="">-- Choose User --</option>
          {users.map(user => (
            <option key={user.id} value={user.id}>{user.name} ({user.email})</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Select Products *</label>
        {selectedItems.map((item, index) => (
          <div key={index} className="item-row">
            <select value={item.productId} onChange={(e) => updateItem(index, 'productId', e.target.value)} required>
              <option value="">-- Choose Product --</option>
              {products.map(product => (
                <option key={product.id} value={product.id}>
                  {product.name} - ${product.price} (Stock: {product.stock})
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              value={item.quantity}
              onChange={(e) => updateItem(index, 'quantity', e.target.value)}
              required
            />
            {selectedItems.length > 1 && (
              <button type="button" onClick={() => removeItem(index)} className="btn-remove">✕</button>
            )}
          </div>
        ))}
        <button type="button" onClick={addItem} className="btn-add">+ Add Product</button>
      </div>

      <div className="total-section">
        <strong>Total: ${calculateTotal().toFixed(2)}</strong>
      </div>

      <button type="submit" disabled={loading} className="btn-submit">
        {loading ? 'Creating...' : 'Create Order'}
      </button>
    </form>
  );
}

export default App;