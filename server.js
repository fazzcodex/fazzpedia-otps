require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ======================= KONFIGURASI =======================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RUMAHOTP_API_KEY = process.env.RUMAHOTP_API_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN; // untuk kirim OTP via Telegram
const MARKUP_PERCENT = parseInt(process.env.MARKUP_PERCENT) || 20;

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', './views');

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'rahasia',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ======================= HELPER FUNCTIONS =======================
// Kirim pesan via Bot Telegram
async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, { chat_id: chatId, text, parse_mode: 'HTML' });
    return true;
  } catch (err) {
    console.error('Telegram send error:', err.message);
    return false;
  }
}

// Kirim email OTP
async function sendEmailOtp(toEmail, otp) {
  const mailOptions = {
    from: `"NokOS Auth" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Kode OTP Login NokOS',
    html: `
      <div style="font-family: Arial; max-width:500px; padding:20px; border:1px solid #e2e8f0; border-radius:16px;">
        <h2 style="color:#2563eb;">FazzPedia - Otps - Kode OTP</h2>
        <p>Gunakan kode berikut untuk login:</p>
        <div style="font-size:32px; font-weight:bold; letter-spacing:4px; background:#f0f9ff; padding:12px; text-align:center; border-radius:12px;">${otp}</div>
        <p style="margin-top:16px; color:#475569;">Kode berlaku 5 menit. Jangan berikan ke siapa pun.</p>
        <hr style="margin:20px 0;">
        <p style="font-size:12px;">© FazzPedia - Auto Order OTP</p>
      </div>
    `
  };
  await transporter.sendMail(mailOptions);
}

// Helper untuk render login dengan default
function renderLogin(res, options = {}) {
  const defaults = {
    error: null,
    step: 'telegram',
    telegramId: '',
    email: '',
    method: 'telegram'
  };
  res.render('login', { ...defaults, ...options });
}

// ======================= DATABASE FUNCTIONS =======================
async function getUserByTelegramId(telegramId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', telegramId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function addBalance(userId, amount) {
  const { data: user } = await supabase
    .from('users')
    .select('balance')
    .eq('id', userId)
    .single();
  const newBalance = (user?.balance || 0) + amount;
  await supabase.from('users').upsert({ id: userId, balance: newBalance });
  return newBalance;
}

async function deductBalance(userId, amount) {
  const { data: user } = await supabase
    .from('users')
    .select('balance')
    .eq('id', userId)
    .single();
  if (!user || user.balance < amount) throw new Error('Saldo tidak cukup');
  const newBalance = user.balance - amount;
  await supabase.from('users').update({ balance: newBalance }).eq('id', userId);
  return newBalance;
}

async function saveOrder(userId, orderId, phoneNumber, service, country, operator, price, status = 'pending') {
  await supabase.from('orders').insert([{
    user_id: userId,
    order_id: orderId,
    phone_number: phoneNumber,
    service,
    country,
    operator,
    price,
    status
  }]);
}

async function getUserOrders(userId, limit = 20) {
  const { data, error } = await supabase
    .from('orders')
    .select('order_id, phone_number, service, country, status, otp_code, created_at, price')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function updateOrderStatus(orderId, status, otpCode = null) {
  const update = { status };
  if (otpCode) update.otp_code = otpCode;
  await supabase.from('orders').update(update).eq('order_id', orderId);
}

async function saveDeposit(depositId, userId, amount, qrImage) {
  await supabase.from('deposits').insert([{ id: depositId, user_id: userId, amount, qr_image: qrImage, status: 'pending' }]);
}

async function updateDepositStatus(depositId, status) {
  await supabase.from('deposits').update({ status, updated_at: new Date() }).eq('id', depositId);
}

async function getUserDeposits(userId, limit = 20) {
  const { data, error } = await supabase
    .from('deposits')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ======================= API RUMAHOTP =======================
async function callRumahOtp(endpoint, params = {}) {
  const url = `https://www.rumahotp.io/api${endpoint}`;
  const response = await axios.get(url, {
    headers: { 'x-apikey': RUMAHOTP_API_KEY, 'Accept': 'application/json' },
    params
  });
  return response.data;
}

function getPriceWithMarkup(originalPrice) {
  return Math.ceil(originalPrice * (1 + MARKUP_PERCENT / 100));
}

async function getServices() {
  const res = await callRumahOtp('/v2/services');
  if (res.success) return res.data;
  throw new Error('Gagal ambil layanan');
}

async function getCountries(serviceId) {
  const res = await callRumahOtp('/v2/countries', { service_id: serviceId });
  if (res.success) return res.data;
  throw new Error('Gagal ambil negara');
}

async function getOperators(countryName, providerId) {
  const res = await callRumahOtp('/v2/operators', { country: countryName, provider_id: providerId });
  if (res.success) return res.data;
  throw new Error('Gagal ambil operator');
}

async function orderNumber(numberId, providerId, operatorId) {
  const res = await callRumahOtp('/v2/orders', { number_id: numberId, provider_id: providerId, operator_id: operatorId });
  if (res.success && res.data) {
    return {
      success: true,
      orderId: res.data.order_id,
      phoneNumber: res.data.phone_number,
      service: res.data.service,
      country: res.data.country,
      price: res.data.price
    };
  }
  return { success: false, error: res.message || 'Order gagal' };
}

async function getOrderStatus(orderId) {
  const res = await callRumahOtp('/v1/orders/get_status', { order_id: orderId });
  if (res.success) {
    return {
      success: true,
      status: res.data.status,
      otpCode: res.data.otp_code,
      otpMsg: res.data.otp_msg
    };
  }
  return { success: false };
}

// ======================= ROUTES LOGIN =======================
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  renderLogin(res);
});

// Kirim OTP Telegram
app.post('/send-otp', async (req, res) => {
  const { telegramId } = req.body;
  if (!telegramId || isNaN(parseInt(telegramId))) {
    return renderLogin(res, { error: 'ID Telegram tidak valid', step: 'telegram', telegramId });
  }
  const user = await getUserByTelegramId(parseInt(telegramId));
  if (!user) {
    return renderLogin(res, { error: 'Telegram ID tidak terdaftar. Start bot dulu.', step: 'telegram', telegramId });
  }
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  req.session.otpData = { telegramId: parseInt(telegramId), otp, expires: Date.now() + 5 * 60 * 1000 };
  const sent = await sendTelegramMessage(parseInt(telegramId), `🔐 Kode OTP login Anda: <code>${otp}</code>\nBerlaku 5 menit.`);
  if (!sent) {
    return renderLogin(res, { error: 'Gagal kirim OTP. Pastikan bot belum diblokir.', step: 'telegram', telegramId });
  }
  renderLogin(res, { step: 'otp', telegramId, method: 'telegram' });
});

// Verifikasi OTP Telegram
app.post('/verify-otp', async (req, res) => {
  const { otp } = req.body;
  const otpData = req.session.otpData;
  if (!otpData || Date.now() > otpData.expires) {
    return renderLogin(res, { error: 'Kode OTP kadaluarsa', step: 'telegram', telegramId: '' });
  }
  if (otp !== otpData.otp) {
    return renderLogin(res, { error: 'Kode OTP salah', step: 'otp', telegramId: otpData.telegramId });
  }
  const user = await getUserByTelegramId(otpData.telegramId);
  req.session.user = user;
  delete req.session.otpData;
  res.redirect('/dashboard');
});

// Kirim OTP Email
app.post('/send-email-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return renderLogin(res, { error: 'Email tidak valid', step: 'email', email, method: 'email' });
  }
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  req.session.emailOtpData = { email, otp, expires: Date.now() + 5 * 60 * 1000 };
  try {
    await sendEmailOtp(email, otp);
    renderLogin(res, { step: 'verify-email', email, method: 'email' });
  } catch (err) {
    console.error(err);
    renderLogin(res, { error: 'Gagal kirim OTP', step: 'email', email, method: 'email' });
  }
});

// Verifikasi OTP Email
app.post('/verify-email-otp', async (req, res) => {
  const { otp } = req.body;
  const otpData = req.session.emailOtpData;
  if (!otpData || Date.now() > otpData.expires) {
    return renderLogin(res, { error: 'Kode OTP kadaluarsa', step: 'email', email: '', method: 'email' });
  }
  if (otp !== otpData.otp) {
    return renderLogin(res, { error: 'Kode OTP salah', step: 'verify-email', email: otpData.email, method: 'email' });
  }
  // Buat user dummy untuk email (tidak terhubung dengan bot)
  const dummyUser = {
    id: `email_${otpData.email.replace(/[^a-z0-9]/gi, '_')}`,
    email: otpData.email,
    balance: 0,
    created_at: new Date().toISOString(),
    loginMethod: 'email'
  };
  req.session.user = dummyUser;
  delete req.session.emailOtpData;
  res.redirect('/dashboard');
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ======================= DASHBOARD & API =======================
app.get('/dashboard', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  try {
    const user = req.session.user;
    const orders = await getUserOrders(user.id, 20);
    const totalSpent = orders.filter(o => o.status === 'completed').reduce((sum, o) => sum + (o.price || 0), 0);
    const services = await getServices();
    res.render('dashboard', { user, orders, totalSpent, services });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading dashboard');
  }
});

// API: countries by service
app.get('/api/countries/:serviceId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const serviceId = parseInt(req.params.serviceId);
    const countries = await getCountries(serviceId);
    res.json({ success: true, countries });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// API: operators
app.get('/api/operators', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { countryName, providerId } = req.query;
  try {
    const operators = await getOperators(countryName, providerId);
    res.json({ success: true, operators });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// API: order
app.post('/api/order', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { numberId, providerId, operatorId, serviceName, countryName, originalPrice } = req.body;
  const userId = req.session.user.id;
  const finalPrice = getPriceWithMarkup(parseInt(originalPrice));
  try {
    if (req.session.user.balance < finalPrice) {
      return res.json({ success: false, error: 'Saldo tidak cukup' });
    }
    const order = await orderNumber(parseInt(numberId), providerId, parseInt(operatorId));
    if (!order.success) throw new Error(order.error);
    await saveOrder(userId, order.orderId, order.phoneNumber, serviceName, countryName, 'any', finalPrice);
    await deductBalance(userId, finalPrice);
    // Refresh session user
    const updatedUser = await getUserByTelegramId(userId);
    if (updatedUser) req.session.user = updatedUser;
    res.json({ success: true, orderId: order.orderId, phoneNumber: order.phoneNumber });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// API: order status
app.get('/api/order-status/:orderId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const status = await getOrderStatus(req.params.orderId);
    if (status.success && status.otpCode) {
      await updateOrderStatus(req.params.orderId, 'completed', status.otpCode);
    }
    res.json(status);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// API: user info (balance)
app.get('/api/user-info', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const user = req.session.user.loginMethod === 'email' 
    ? req.session.user 
    : await getUserByTelegramId(req.session.user.id);
  res.json({ balance: user?.balance || 0 });
});

// API: user orders (for history refresh)
app.get('/api/user-orders', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const orders = await getUserOrders(req.session.user.id, 50);
  res.json({ success: true, orders });
});

// API: bot stats
app.get('/api/bot-stats', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { count: totalOrders } = await supabase.from('orders').select('*', { count: 'exact', head: true });
  const today = new Date(); today.setHours(0,0,0,0);
  const { count: ordersToday } = await supabase.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', today.toISOString());
  const startOfWeek = new Date(today); const day = today.getDay(); const diff = (day === 0 ? 6 : day - 1);
  startOfWeek.setDate(today.getDate() - diff);
  const { count: ordersThisWeek } = await supabase.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', startOfWeek.toISOString());
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const { count: ordersThisMonth } = await supabase.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', startOfMonth.toISOString());
  res.json({ totalUsers, totalOrders, ordersToday, ordersThisWeek, ordersThisMonth });
});

// ======================= DEPOSIT & TOPUP =======================
app.post('/api/topup', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { amount } = req.body;
  if (amount < 10000) return res.json({ success: false, error: 'Minimal Rp10.000' });
  try {
    const response = await callRumahOtp('/v2/deposit/create', { amount, payment_id: 'qris' });
    if (response.success) {
      const depositId = response.data.id;
      const qrImage = response.data.qr_image;
      await saveDeposit(depositId, req.session.user.id, amount, qrImage);
      res.json({ success: true, qrImage, depositId });
    } else {
      res.json({ success: false, error: 'Gagal generate QRIS' });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/topup-status/:depositId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { depositId } = req.params;
  try {
    const response = await callRumahOtp('/v2/deposit/get_status', { deposit_id: depositId });
    if (response.success && response.data.status === 'success') {
      const amountReceived = response.data.diterima;
      await addBalance(req.session.user.id, amountReceived);
      await updateDepositStatus(depositId, 'success');
      const updatedUser = req.session.user.loginMethod === 'email' 
        ? { ...req.session.user, balance: (req.session.user.balance || 0) + amountReceived }
        : await getUserByTelegramId(req.session.user.id);
      req.session.user = updatedUser;
      res.json({ success: true, status: 'success', amount: amountReceived });
    } else {
      res.json({ success: false, status: response.data?.status || 'pending' });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/cancel-deposit/:depositId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { depositId } = req.params;
  try {
    const { data: deposit, error } = await supabase
      .from('deposits')
      .select('*')
      .eq('id', depositId)
      .eq('user_id', req.session.user.id)
      .single();
    if (error || !deposit) return res.json({ success: false, error: 'Deposit tidak ditemukan' });
    if (deposit.status !== 'pending') return res.json({ success: false, error: 'Deposit sudah diproses' });
    await updateDepositStatus(depositId, 'canceled');
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/deposits', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const deposits = await getUserDeposits(req.session.user.id, 20);
  res.json({ success: true, deposits });
});

// ======================= START SERVER =======================
app.listen(PORT, () => {
  console.log(`🚀 NokOS Server running at http://localhost:${PORT}`);
});

module.exports = app;
