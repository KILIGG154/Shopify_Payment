require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Import route xử lý VNPAY
const vnpayRoutes = require('./routes/vnpay');

// Middleware hỗ trợ parse body (khi nhận dữ liệu json và form-urlencoded)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Định tuyến cơ bản
app.get('/', (req, res) => {
    res.send('Server is running! Tích hợp VNPAY - Shopify.');
});

// Middleware xử lý các router của VNPAY
app.use('/vnpay', vnpayRoutes);

// Khởi chạy server
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});
