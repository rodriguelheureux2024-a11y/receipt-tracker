const express  = require('express');
const multer   = require('multer');
const Groq     = require('groq-sdk');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });
const JWT_SECRET   = process.env.JWT_SECRET || 'receiptiq-dev-secret-change-in-prod';
const DATA_DIR     = path.join(__dirname, 'data');
const USERS_FILE   = path.join(DATA_DIR, 'users.json');
const REC_DIR      = path.join(DATA_DIR, 'receipts');

[DATA_DIR, REC_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

/* ── TEMPORARY ADMIN RESET (remove after use) ── */
app.get('/api/admin/reset-all', (req, res) => {
  fs.writeFileSync(USERS_FILE, '[]');
  fs.readdirSync(REC_DIR).forEach(f => fs.unlinkSync(path.join(REC_DIR, f)));
  res.send('✅ Toutes les données ont été effacées. Vous pouvez créer un nouveau compte.');
});

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
const PROMPT = `You are a receipt scanner. Look at the receipt image and extract every purchased item.

YOU MUST return a JSON object. Start your response with { and end with }.

Format:
{"store":"store name","date":"YYYY-MM-DD","total":0.00,"items":[{"name":"product name","price":0.00,"quantity":1,"category":"category"}]}

CRITICAL RULES:
1. List EVERY product line on the receipt as a separate item in the "items" array
2. DO NOT include: "Regular Price", "Save$", "Savings", "SUBTOTAL", "TAX", "TOTAL", "VISA", "AUTH CODE"
3. Tax codes (NF, F, T, WIC) after a price are NOT product names — ignore them
4. "3 @ $1.00 ea" = quantity:3, price:3.00
5. If you see product lines, you MUST include them all — the items array must NOT be empty

Categories to use:
"Fruits","Légumes","Viandes & Poissons","Produits Laitiers","Boulangerie & Pâtisserie","Boissons","Épicerie Sèche","Surgelés","Hygiène & Beauté","Entretien Maison","Santé","Snacks & Confiseries","Autres"

Quick brand guide: KASHI/CHEERIOS=Épicerie Sèche | CHOBANI/YOPLAIT=Produits Laitiers | PASTA/RICE=Épicerie Sèche | BEEF/CHICKEN/SALMON=Viandes & Poissons | WATER/JUICE/SODA=Boissons | CHIPS/COOKIES=Snacks & Confiseries | SHAMPOO/SOAP=Hygiène & Beauté | DETERGENT=Entretien Maison

Today is ${new Date().toISOString().split('T')[0]} (use as date if not visible on receipt).`;

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

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 4096,
      temperature: 0.05,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imgData}` } },
          { type: 'text', text: PROMPT }
        ]
      }]
    });

    let rawText = response.choices[0].message.content.trim();
    console.log('AI RAW:', rawText.slice(0, 300));

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

    // Normalize total too
    if (data.total) data.total = parseFloat(String(data.total).replace(/[^0-9.]/g, '')) || 0;

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
