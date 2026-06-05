const express  = require('express');
const multer   = require('multer');
const { Mistral } = require('@mistralai/mistralai');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

const app     = express();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const JWT_SECRET   = process.env.JWT_SECRET || 'receiptiq-dev-secret-change-in-prod';
const DATA_DIR     = path.join(__dirname, 'data');
const USERS_FILE   = path.join(DATA_DIR, 'users.json');
const REC_DIR      = path.join(DATA_DIR, 'receipts');

[DATA_DIR, REC_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');


app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ── DATA HELPERS ── */
const loadUsers = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } };
const saveUsers = u  => fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
const loadRec   = id => { try { return JSON.parse(fs.readFileSync(path.join(REC_DIR, `${id}.json`), 'utf8')); } catch { return []; } };
const saveRec   = (id, data) => fs.writeFileSync(path.join(REC_DIR, `${id}.json`), JSON.stringify(data, null, 2));

/* ── AUTH MIDDLEWARE ── */
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non authentifié' });
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expirée — reconnectez-vous' }); }
}

/* ── AUTH ROUTES ── */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Tous les champs sont requis' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });
    const users = loadUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'Email déjà utilisé' });
    const user = { id: crypto.randomUUID(), name: name.trim(), email: email.toLowerCase().trim(), password: await bcrypt.hash(password, 10), createdAt: new Date().toISOString() };
    users.push(user);
    saveUsers(users);
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email?.toLowerCase().trim());
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, (req, res) => res.json({ id: req.user.id, name: req.user.name, email: req.user.email }));

/* ── RECEIPT PROMPT ── */
const PROMPT = `You are a receipt scanner. Read the receipt image and output ONLY a JSON object.

{"store":"...","date":"YYYY-MM-DD","total":0.00,"items":[{"name":"...","price":0.00,"quantity":1,"category":"..."}]}

━━━ GOLDEN RULES (memorize these) ━━━
RULE 1: The number on the RIGHT side of a product line is ALWAYS the price. Always.
RULE 2: The number at the BOTTOM RIGHT of the receipt (labeled "Total") is the grand total.
RULE 3: Write product names EXACTLY as printed — never change or expand abbreviations.
RULE 4: Include every product, even those with discounts shown below them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE 1 — Store with tax codes and discounts (Target style)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Receipt text:
  KASHI CEREAL        NF   $5.79    ← item, price = 5.79
    Reg $6.99                       ← SKIP (old price)
  CHOBANI YOGURT      NF   $1.00    ← item, price = 1.00
    Reg $1.39                       ← SKIP
    6for$6                          ← SKIP (promo)
  CHOBANI YOGURT      NF   $3.00    ← item, price = 3.00
    3 @ $1.00 ea                    ← quantity info: qty=3
  LAURA LEAN BEEF     NF   $9.99    ← item, price = 9.99
  SUBTOTAL                 $19.78   ← SKIP
  NO TAX                    $0.00   ← SKIP
  TOTAL                    $19.78   ← grand total

Correct output:
{"store":"Target","date":"2026-03-10","total":19.78,"items":[
  {"name":"KASHI CEREAL","price":5.79,"quantity":1,"category":"Épicerie Sèche"},
  {"name":"CHOBANI YOGURT","price":1.00,"quantity":1,"category":"Produits Laitiers"},
  {"name":"CHOBANI YOGURT","price":3.00,"quantity":3,"category":"Produits Laitiers"},
  {"name":"LAURA LEAN BEEF","price":9.99,"quantity":1,"category":"Viandes & Poissons"}
]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE 2 — Store with weight items and savings (Whole Foods style)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Receipt text:
  NPA HERITAGE CRL OG      $5.19 F  ← item, price = 5.19
  EDN OG WHL GRN MILLET    $4.02 F  ← item, price = 4.02 (it IS an item even with savings below)
    Reg $5.29                        ← SKIP
    Savings ($1.27)                  ← SKIP
  BRM OG UNBLCHD WT FLOUR $10.49 F  ← item, price = 10.49
  MSC ATLANTIC COD FILLET  $10.59 F ← item, price = 10.59
    Qty 0.53 lb @ $19.99/lb          ← SKIP (weight detail, NOT a new item)
  OG YELLOW ONION           $4.93 F ← item, price = 4.93
    Qty 1.65 lb @ $2.99/lb           ← SKIP (1.65 is a WEIGHT not a price!)
    Tare Weight 0.04 lb              ← SKIP
  OG GARLIC                 $0.77 F ← item, price = 0.77
    Qty 0.11 lb @ $6.99/lb           ← SKIP
  OG GARLIC                 $1.12 F ← item, price = 1.12
    Qty 0.16 lb @ $6.99/lb           ← SKIP
  Subtotal                 $87.22   ← SKIP
  Total Savings             -$2.72  ← SKIP
  TOTAL                    $87.22   ← grand total

Correct output:
{"store":"Whole Foods Market","date":"2026-03-10","total":87.22,"items":[
  {"name":"NPA HERITAGE CRL OG","price":5.19,"quantity":1,"category":"Épicerie Sèche"},
  {"name":"EDN OG WHL GRN MILLET","price":4.02,"quantity":1,"category":"Épicerie Sèche"},
  {"name":"BRM OG UNBLCHD WT FLOUR","price":10.49,"quantity":1,"category":"Épicerie Sèche"},
  {"name":"MSC ATLANTIC COD FILLET","price":10.59,"quantity":1,"category":"Viandes & Poissons"},
  {"name":"OG YELLOW ONION","price":4.93,"quantity":1,"category":"Légumes"},
  {"name":"OG GARLIC","price":0.77,"quantity":1,"category":"Légumes"},
  {"name":"OG GARLIC","price":1.12,"quantity":1,"category":"Légumes"}
]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LINES TO ALWAYS SKIP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"Reg $" | "Regular Price" | "Savings" | "Save $" | "Total Savings"
"Qty X lb @" | "Tare Weight" | "Subtotal" | "Net Sales"
"Total" | "Paid" | "VISA" | "Sold Items" | "Auth Code"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CATEGORIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"Fruits" | "Légumes" | "Viandes & Poissons" | "Produits Laitiers" | "Boulangerie & Pâtisserie" | "Boissons" | "Épicerie Sèche" | "Surgelés" | "Hygiène & Beauté" | "Entretien Maison" | "Santé" | "Snacks & Confiseries" | "Autres"

FLOUR/GRAIN/CEREAL/PASTA/NUTS/ALMONDS/COUSCOUS/MILLET/TOFU/SEEDS/RICE → Épicerie Sèche
COD/FISH/SALMON/BEEF/CHICKEN/MEAT/FILLET/TUNA → Viandes & Poissons
ONION/GARLIC/TOMATO/GINGER/CARROT/LETTUCE/VEGETABLE → Légumes
ORANGE/APPLE/BERRY/MANGO/GRAPE/BANANA/FRUIT → Fruits
MILK/YOGURT/CHEESE/BUTTER/CREAM/EGG → Produits Laitiers
WATER/JUICE/SODA/COFFEE/TEA/WINE/BEER → Boissons
CHIPS/COOKIE/CHOCOLATE/CANDY/SNACK/CRACKER → Snacks & Confiseries
SHAMPOO/SOAP/TOOTHPASTE/DEODORANT → Hygiène & Beauté
DETERGENT/CLEANER/SPONGE/PAPER TOWEL → Entretien Maison

Use date ${new Date().toISOString().split('T')[0]} if not visible on receipt.`;

/* ── ANALYZE ── */
app.post('/api/analyze', auth, upload.single('image'), async (req, res) => {
  try {
    let imgData, mediaType;
    if (req.file) {
      imgData = req.file.buffer.toString('base64'); mediaType = req.file.mimetype;
    } else if (req.body.imageBase64) {
      const m = req.body.imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      imgData = m ? m[2] : req.body.imageBase64; mediaType = m ? m[1] : 'image/jpeg';
    } else return res.status(400).json({ error: 'Aucune image fournie' });

    const response = await mistral.chat.complete({
      model: 'pixtral-12b-2409',
      maxTokens: 4096,
      temperature: 0.05,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', imageUrl: `data:${mediaType};base64,${imgData}` },
          { type: 'text',      text: PROMPT }
        ]
      }]
    });

    let rawText = response.choices[0].message.content.trim();
    console.log('PIXTRAL RAW:', rawText.slice(0, 400));

    // Robustly extract the first complete JSON object
    const start = rawText.indexOf('{');
    if (start === -1) throw new Error('Réponse illisible — réessayez avec une photo plus nette');
    let depth = 0, end = -1;
    for (let i = start; i < rawText.length; i++) {
      if (rawText[i] === '{') depth++;
      else if (rawText[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error('JSON incomplet dans la réponse');
    const data = JSON.parse(rawText.slice(start, end + 1));

    // Support alternative keys (items / products / line_items)
    if (!data.items && data.products)   data.items = data.products;
    if (!data.items && data.line_items) data.items = data.line_items;
    if (!Array.isArray(data.items))     data.items = [];

    // Normalize every item — handle string prices like "$5.79"
    data.items = data.items.map(i => ({
      name:     String(i.name || '').trim(),
      price:    parseFloat(String(i.price  || '0').replace(/[^0-9.]/g, '')) || 0,
      quantity: parseInt(String(i.quantity || '1').replace(/[^0-9]/g, ''))  || 1,
      category: i.category || 'Autres',
    })).filter(i => i.name.length > 0);  // only remove nameless items

    // Normalize total
    if (data.total) data.total = parseFloat(String(data.total).replace(/[^0-9.]/g, '')) || 0;

    // Normalize date to YYYY-MM-DD (handle "Mar 10, 2026", "10/03/2026", etc.)
    if (data.date) {
      try {
        const d = new Date(data.date);
        data.date = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      } catch { data.date = new Date().toISOString().split('T')[0]; }
    }

    if (data.items.length === 0) {
      throw new Error('Aucun article trouvé. Prenez la photo plus près et assurez-vous que le ticket est bien éclairé.');
    }

    res.json({ success: true, data });
  } catch (e) {
    console.error('analyze error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ── RECEIPTS ── */
app.post('/api/receipts', auth, (req, res) => {
  const list = loadRec(req.user.id);
  const rec  = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString() };
  list.push(rec);
  saveRec(req.user.id, list);
  res.json({ success: true, data: rec });
});

app.get('/api/receipts',        auth, (req, res) => res.json(loadRec(req.user.id)));
app.delete('/api/receipts/:id', auth, (req, res) => { saveRec(req.user.id, loadRec(req.user.id).filter(r => r.id !== req.params.id)); res.json({ success: true }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ ReceiptIQ v2 → http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY)  console.warn('⚠️  GROQ_API_KEY manquante');
  if (!process.env.JWT_SECRET)    console.warn('⚠️  JWT_SECRET non défini (utilise la valeur par défaut)');
});
