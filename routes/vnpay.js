const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Hàm format ngày giờ theo chuẩn VNPAY (YYYYMMDDHHmmss)
function getCreateDate() {
    const date = new Date();
    const yyyy = date.getFullYear().toString();
    const mm = (date.getMonth() + 1).toString().padStart(2, '0');
    const dd = date.getDate().toString().padStart(2, '0');
    const HH = date.getHours().toString().padStart(2, '0');
    const MM = date.getMinutes().toString().padStart(2, '0');
    const ss = date.getSeconds().toString().padStart(2, '0');
    return `${yyyy}${mm}${dd}${HH}${MM}${ss}`;
}

// Hàm sort object alphabet để tạo chuỗi ký
function sortObject(obj) {
    let sorted = {};
    let str = [];
    let key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) {
            str.push(encodeURIComponent(key));
        }
    }
    str.sort();
    for (key = 0; key < str.length; key++) {
        sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
    }
    return sorted;
}

// Hàm nối chuỗi params sau khi sort không bị encode hai lần
function buildQueryString(params) {
    return Object.entries(params).map(([key, value]) => `${key}=${value}`).join('&');
}

// API: Tạo đường dẫn URL để redirect người dùng sang trang thanh toán VNPAY
router.post('/create-payment', (req, res) => {
    let ipAddr = req.headers['x-forwarded-for'] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        req.connection?.socket?.remoteAddress || '127.0.0.1';

    let tmnCode = process.env.VNP_TMN_CODE;
    let secretKey = process.env.VNP_HASH_SECRET;
    let vnpUrl = process.env.VNP_URL;
    let returnUrl = process.env.VNP_RETURN_URL;

    let date = getCreateDate();

    // Lấy thông tin từ client gửi lên (dựa theo lệnh curl)
    let amount = req.body.amount;
    let orderInfo = req.body.orderInfo || 'Thanh toan don hang';
    let orderId = req.body.orderId || Math.floor(Math.random() * 100000);

    let vnp_Params = {};
    vnp_Params['vnp_Version'] = '2.1.0';
    vnp_Params['vnp_Command'] = 'pay';
    vnp_Params['vnp_TmnCode'] = tmnCode;
    vnp_Params['vnp_Locale'] = 'vn';
    vnp_Params['vnp_CurrCode'] = 'VND';
    vnp_Params['vnp_TxnRef'] = orderId;
    vnp_Params['vnp_OrderInfo'] = orderInfo;
    vnp_Params['vnp_OrderType'] = 'other';
    vnp_Params['vnp_Amount'] = amount * 100; // Số tiền phải nhân 100 theo chuẩn VNPAY
    vnp_Params['vnp_ReturnUrl'] = returnUrl;
    vnp_Params['vnp_IpAddr'] = ipAddr;
    vnp_Params['vnp_CreateDate'] = date;

    vnp_Params = sortObject(vnp_Params);

    // Ký xác thực dữ liệu
    let signData = buildQueryString(vnp_Params);
    let hmac = crypto.createHmac("sha512", secretKey);
    let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");

    // Nối chữ ký bảo mật vào cuối params
    vnp_Params['vnp_SecureHash'] = signed;
    vnpUrl += '?' + buildQueryString(vnp_Params);

    // Trả về một đối tượng json chứa "target_url" thay vì redirect trực tiếp cho frontend tự redirect
    res.json({ target_url: vnpUrl });
});

// API: VNPAY sẽ redirect người dùng trở lại web bằng GET theo URL này sau khi thanh toán xong
router.get('/vnpay_return', (req, res) => {
    let vnp_Params = req.query;

    let secureHash = vnp_Params['vnp_SecureHash'];

    delete vnp_Params['vnp_SecureHash'];
    delete vnp_Params['vnp_SecureHashType'];

    vnp_Params = sortObject(vnp_Params);

    let secretKey = process.env.VNP_HASH_SECRET;
    let signData = buildQueryString(vnp_Params);
    let hmac = crypto.createHmac("sha512", secretKey);
    let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");

    if (secureHash === signed) {
        // Kiểm tra xem phản hồi có phải là thành công ('00')
        if (vnp_Params['vnp_ResponseCode'] === '00') {
            res.send(`<html><body><h1 style="color:green">Giao dịch thành công</h1>
                      <p>Mã hóa đơn: ${vnp_Params['vnp_TxnRef']}</p>
                      <p>Số tiền: ${vnp_Params['vnp_Amount'] / 100} VND</p></body></html>`);
        } else {
            res.send(`<html><body><h1 style="color:red">Giao dịch thất bại</h1>
                      <p>Mã hóa đơn: ${vnp_Params['vnp_TxnRef']}</p>
                      <p>Mã lỗi từ VNPAY: ${vnp_Params['vnp_ResponseCode']}</p></body></html>`);
        }
    } else {
        res.send('<html><body><h1 style="color:red">Giao dịch thất bại</h1><p>Sai chữ ký bảo mật do dữ liệu bị can thiệp (Invalid Signature)</p></body></html>');
    }
});

// API: IPN xử lý bất đồng bộ từ máy chủ VNPAY
router.get('/vnpay_ipn', (req, res) => {
    let vnp_Params = req.query;
    let secureHash = vnp_Params['vnp_SecureHash'];

    delete vnp_Params['vnp_SecureHash'];
    delete vnp_Params['vnp_SecureHashType'];

    vnp_Params = sortObject(vnp_Params);

    let secretKey = process.env.VNP_HASH_SECRET;
    let signData = buildQueryString(vnp_Params);
    let hmac = crypto.createHmac("sha512", secretKey);
    let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");

    if (secureHash === signed) {
        let orderId = vnp_Params['vnp_TxnRef'];
        let rspCode = vnp_Params['vnp_ResponseCode'];

        // Tại đây bạn sẽ đối chiếu Database (so sánh số tiền, trạng thái đơn hàng v.v.)
        // Tuy nhiên trong bản mockup này, chúng ta ghi nhận thành công luôn.
        res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
    }
    else {
        res.status(200).json({ RspCode: '97', Message: 'Fail checksum' });
    }
});

module.exports = router;
