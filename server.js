const express = require('express');
const multer  = require('multer');
const Groq    = require('groq-sdk');
const fs      = require('fs');
const path    = require('path');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });

const DATA_FILE = path.join(__dirname, 'data', 'receipts.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function load()     { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; } }
function save(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

const PROMPT = `You are a receipt analysis expert. Look carefully at this receipt image and extract ALL purchase data.

Return ONLY a valid JSON object — no markdown, no explanation, nothing else.

JSON format:
{
  "store": "store name from receipt header",
  "date": "YYYY-MM-DD",
  "total": 38.74,
  "items": [
    { "name": "Product name", "price": 5.79, "quantity": 1, "category": "category" }
  ]
}

HOW TO READ THE RECEIPT:
- The store name is usually at the very top (logo or header text)
- Each product line typically shows: barcode/SKU, product name, price
- Lines with "NF", "F", "T", "WIC" after the price are tax codes — ignore them
- Lines starting with "Regular Price", "Save$", "Savings", "You Saved" are discounts — DO NOT include as items
- The TOTAL is the final amount paid (after discounts and taxes)
- "SUBTOTAL", "TAX", "TOTAL" lines are summary lines — don't include as items
- Visa/payment lines are not items

CATEGORIES — pick exactly one:
- "Fruits" → fresh fruits
- "Légumes" → fresh vegetables
- "Viandes & Poissons" → meat, fish, poultry, deli
- "Produits Laitiers" → milk, yogurt, cheese, butter, eggs, dairy
- "Boulangerie & Pâtisserie" → bread, pastries, bakery
- "Boissons" → water, juice, soda, coffee, tea, alcohol
- "Épicerie Sèche" → pasta, rice, canned goods, cereals, condiments, oil
- "Surgelés" → frozen foods
- "Hygiène & Beauté" → shampoo, soap, toothpaste, cosmetics
- "Entretien Maison" → cleaning products, laundry, household
- "Santé" → medicine, vitamins, supplements
- "Snacks & Confiseries" → chips, candy, chocolate, cookies, snacks
- "Autres" → anything that doesn't fit above

IMPORTANT RULES:
- Include EVERY product line (not discounts, not totals)
- "KASHI" → "Épicerie Sèche" (cereal brand)
- "CHOBANI" → "Produits Laitiers" (yogurt brand)
- "GO PASTA" → "Épicerie Sèche"
- "POP FRUIT" → "Snacks & Confiseries" or "Fruits"
- "LAURA'S LEAN" → "Viandes & Poissons" (beef brand)
- "SIMPLY BEVERA" → "Boissons"
- For quantities like "3 @ $1.00 ea" → quantity=3, price=3.00
- date format must be YYYY-MM-DD (use ${new Date().toISOString().split('T')[0]} if not visible)`;

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    let imgData, mediaType;
    if (req.file) {
      imgData   = req.file.buffer.toString('base64');
      mediaType = req.file.mimetype;
    } else if (req.body.imageBase64) {
      const m = req.body.imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (m) { mediaType = m[1]; imgData = m[2]; }
      else   { mediaType = 'image/jpeg'; imgData = req.body.imageBase64; }
    } else {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 3000,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imgData}` } },
          { type: 'text', text: PROMPT }
        ]
      }]
    });

    let text = response.choices[0].message.content.trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    // Remove any text before the first {
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) text = text.slice(start, end + 1);

    const data = JSON.parse(text);
    res.json({ success: true, data });

  } catch (err) {
    console.error('analyze error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/receipts', (req, res) => {
  const receipts = load();
  const receipt  = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString() };
  receipts.push(receipt);
  save(receipts);
  res.json({ success: true, data: receipt });
});

app.get('/api/receipts',      (_req, res) => res.json(load()));
app.delete('/api/receipts/:id', (req, res) => { save(load().filter(r => r.id !== req.params.id)); res.json({ success: true }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ ReceiptIQ → http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) console.warn('⚠️  GROQ_API_KEY manquante → https://console.groq.com/keys');
});
