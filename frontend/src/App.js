import React, { useState, useEffect } from 'react';
import './App.css';

const API = process.env.REACT_APP_API_URL; // e.g., https://<your-api>.onrender.com
console.log('API:', API);
if (!API) console.warn('REACT_APP_API_URL is missing');

// Helpers
async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

export async function loadOrders() {
  const url = new URL('/orders', API);
  const res = await fetch(url.toString(), { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET /orders failed: ${res.status} ${text}`);
  }
  return res.json();
}

function App() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => { fetchOrders(); }, [page, search]);

  function fetchOrders() {
    setLoading(true);

    const base = API;
    if (!base) console.warn('REACT_APP_API_URL is missing');

    const url = new URL('/orders', base);
    const params = new URLSearchParams({ page: String(page), limit: '5' });
    if (search) params.set('search', search);
    url.search = params.toString();

    fetch(url.toString(), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`${res.status} ${t}`);
        }
        return res.json();
      })
      .then((data) => {
        // Backend returns { data: Order[], pagination: { totalPages, ... } }
        setOrders(Array.isArray(data?.data) ? data.data : []);
        setTotalPages(Number(data?.pagination?.totalPages || 1));
        setLoading(false);
      })
      .catch((err) => {
        console.error('GET /orders failed:', err);
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
  if (!Array.isArray(orders) || orders.length === 0) {
    return (
      <div className="no-orders">
        <p>📭 No orders found</p>
      </div>
    );
  }

  return (
    <div className="orders-list">
      {orders.map((order) => {
        const created = order.createdAt ? new Date(order.createdAt) : null;
        const items = Array.isArray(order.orderItems) ? order.orderItems : [];

        return (
          <div key={order.id} className="order-card">
            <div className="order-header">
              <div>
                <h3>Order #{order.id}</h3>
                <p className="user-name">👤 {order.user?.name || 'Unknown User'}</p>
                <p className="date">📅 {created ? created.toLocaleDateString() : '-'}</p>
              </div>
              <div className="order-right">
                <span className={`status ${order.status || 'pending'}`}>{(order.status || 'pending').toUpperCase()}</span>
                <p className="total">${Number(order.total || 0).toFixed(2)}</p>
              </div>
            </div>

            <div className="order-items">
              <strong>Items:</strong>
              {items.length === 0 ? (
                <div className="item">—</div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="item">
                    <span>{item.product?.name || 'Product'} × {item.quantity}</span>
                    <span>${Number(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
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
    // Load users/products safely
    (async () => {
      try {
        const [uRes, pRes] = await Promise.all([
          fetch(new URL('/users', API).toString()),
          fetch(new URL('/products', API).toString()),
        ]);
        const [u, p] = await Promise.all([uRes.json(), pRes.json()]);
        setUsers(Array.isArray(u) ? u : []);
        setProducts(Array.isArray(p) ? p : []);
      } catch (e) {
        console.error('Preload failed', e);
      }
    })();
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
    for (const item of selectedItems) {
      if (item.productId) {
        const prod = products.find(p => p.id === Number(item.productId));
        if (prod) total += Number(prod.price) * Number(item.quantity || 0);
      }
    }
    return total;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const userId = Number(selectedUserId);
    if (!userId) {
      alert('Please select a user');
      return;
    }

    const validItems = selectedItems
      .map(i => ({ productId: Number(i.productId), quantity: Number(i.quantity) }))
      .filter(i => i.productId && i.quantity > 0);

    if (validItems.length === 0) {
      alert('Please add at least one product');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(new URL('/orders', API).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId, items: validItems }),
      });

      if (!res.ok) {
        const body = await safeJson(res);
        const msg = body?.error || body?.detail || 'Unknown error';
        throw new Error(`Create order failed (${res.status}): ${msg}`);
      }

      await res.json(); // created order (not used here)
      alert('✅ Order created!');
      onSuccess();
    } catch (err) {
      console.error(err);
      alert('❌ ' + (err.message || 'Failed to create order'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="create-form">
      <h3>Create New Order</h3>

      <div className="form-group">
        <label>Select User *</label>
        <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} required>
          <option value="">-- Choose User --</option>
          {users.map(user => (
            <option key={user.id} value={user.id}>
              {user.name} ({user.email})
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Select Products *</label>
        {selectedItems.map((item, index) => (
          <div key={index} className="item-row">
            <select
              value={item.productId}
              onChange={(e) => updateItem(index, 'productId', e.target.value)}
              required
            >
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