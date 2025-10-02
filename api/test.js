// Простой тест для Vercel
export default function handler(req, res) {
  res.status(200).json({ 
    message: 'Vercel test successful!',
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url
  });
}
