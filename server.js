const express   = require('express');
const multer    = require('multer');
const FormData  = require('form-data');
const fetch     = require('node-fetch');   // compatible Node 14/16/18/20
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const JWT_SECRET = process.env.JWT_SECRET || 'receiptiq-dev-secret-change-in-prod';
const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REC_DIR    = path.join(DATA_DIR, 'receipts');

[DATA_DIR, REC_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ── DATA ── */
const loadUsers = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } };
const saveUsers = u  => fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
const loadRec   = id => { try { return JSON.parse(fs.readFileSync(path.join(REC_DIR, `${id}.json`), 'utf8')); } catch { return []; } };
const saveRec   = (id, data) => fs.writeFileSync(path.join(REC_DIR, `${id}.json`), JSON.stringify(data, null, 2));

/* ── AUTH ── */
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non authentifié' });
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expirée — reconnectez-vous' }); }
}

/* ── CATEGORIZATION ── */
function categorize(name = '') {
  const n = name.toUpperCase();
  if (/APPLE|BANANA|ORANGE|BERRY|GRAPE|MANGO|PEACH|PEAR|PLUM|CHERRY|LEMON|LIME|MELON|KIWI|PINEAPPLE|APRICOT|CARA CARA|CLEMENTINE|TANGERINE|GRAPEFRUIT|POMELO|JACKFRUIT|PAPAYA|GUAVA|PASSION FRUIT/.test(n)) return 'Fruits';
  if (/ONION|GARLIC|TOMATO|CARROT|LETTUCE|SPINACH|BROCCOLI|PEPPER|GINGER|POTATO|MUSHROOM|ZUCCHINI|CELERY|KALE|CUCUMBER|CABBAGE|CAULIFLOWER|ASPARAGUS|BEET|RADISH|TURNIP|YAM|SQUASH|FENNEL|LEEK|ARUGULA|CHARD|ARTICHOKE|WATERCRESS|ENDIVE/.test(n)) return 'Légumes';
  if (/BEEF|CHICKEN|PORK|LAMB|FISH|SALMON|COD|TUNA|SHRIMP|CRAB|FILLET|STEAK|GROUND|TURKEY|DUCK|BACON|HAM|SAUSAGE|SALAMI|TILAPIA|TROUT|HALIBUT|SEAFOOD|SCALLOP|MUSSEL|OYSTER|LOBSTER|MEAT|LEAN|SIRLOIN|TENDERLOIN/.test(n)) return 'Viandes & Poissons';
  if (/MILK|YOGURT|YOGHURT|CHEESE|BUTTER|CREAM|DAIRY|KEFIR|RICOTTA|MOZZARELLA|CHEDDAR|BRIE|PARMESAN|GOUDA|EGG/.test(n)) return 'Produits Laitiers';
  if (/BREAD|BAGUETTE|CROISSANT|PASTRY|CAKE|BAGEL|MUFFIN|ROLL|BRIOCHE|SOURDOUGH|LOAF|SCONE|WAFFLE|CRUMPET|PITA|TORTILLA|NAAN/.test(n)) return 'Boulangerie & Pâtisserie';
  if (/WATER|JUICE|SODA|COFFEE|TEA|WINE|BEER|CIDER|LEMONADE|KOMBUCHA|SPARKLING|BEVERAGE|DRINK|COCONUT WATER|ALMOND MILK|OAT MILK|SOY MILK|MATCHA|ESPRESSO/.test(n)) return 'Boissons';
  if (/FLOUR|GRAIN|CEREAL|PASTA|RICE|ALMOND|NUT|SEED|COUSCOUS|MILLET|TOFU|OATS|QUINOA|LENTIL|BEAN|OIL|VINEGAR|SAUCE|HONEY|JAM|SYRUP|PEANUT|TAHINI|HUMMUS|SALSA|KETCHUP|MUSTARD|MAYO|SPICE|SALT|SUGAR|BUCKWHEAT|SUNFLOWER|CHIA|FLAX|HEMP|CANNED|CONSERVE|BROTH|STOCK|NOODLE|SPAGHETTI|MACARONI|COUSCOUS/.test(n)) return 'Épicerie Sèche';
  if (/FROZEN|ICE CREAM|SORBET|GELATO/.test(n)) return 'Surgelés';
  if (/SHAMPOO|CONDITIONER|SOAP|BODY WASH|TOOTHPASTE|DEODORANT|LOTION|MOISTURIZER|SUNSCREEN|RAZOR|MAKEUP|LIPSTICK|MASCARA|PERFUME|COLOGNE/.test(n)) return 'Hygiène & Beauté';
  if (/DETERGENT|LAUNDRY|CLEANER|SPONGE|PAPER TOWEL|TOILET PAPER|BLEACH|DISH SOAP|TRASH BAG/.test(n)) return 'Entretien Maison';
  if (/VITAMIN|SUPPLEMENT|MEDICINE|TABLET|CAPSULE|ADVIL|TYLENOL|IBUPROFEN|ASPIRIN|BANDAGE/.test(n)) return 'Santé';
  if (/CHIP|COOKIE|CHOCOLATE|CANDY|SNACK|CRACKER|PRETZEL|POPCORN|GRANOLA BAR|BROWNIE|GUMMY|MARSHMALLOW/.test(n)) return 'Snacks & Confiseries';
  return 'Autres';
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
    users.push(user); saveUsers(users);
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

/* ── MINDEE HELPER ── */
const MINDEE_MODEL_ID = 'fee72ca6-432d-4e5f-afc4-0fbaa2a0e518';

async function analyzeOneImage(imgBuffer) {
  const AUTH = (process.env.MINDEE_API_KEY || '').trim();
  const form = new FormData();
  form.append('file', imgBuffer, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
  form.append('model_id', MINDEE_MODEL_ID);

  const submitRes = await fetch('https://api-v2.mindee.net/v2/inferences/enqueue', {
    method: 'POST',
    headers: { 'Authorization': AUTH, ...form.getHeaders() },
    body: form,
  });
  if (!submitRes.ok) {
    const t = await submitRes.text();
    throw new Error(`Mindee ${submitRes.status}: ${t}`);
  }
  const submitJson = await submitRes.json();
  const pollUrl = submitJson.job?.polling_url || `https://api-v2.mindee.net/v2/jobs/${submitJson.job?.id}`;

  let pollData;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    const pollRes = await fetch(pollUrl, { headers: { 'Authorization': AUTH } });
    pollData = await pollRes.json();
    if (pollData.job?.status !== 'Processing') break;
  }

  const fields = pollData?.inference?.result?.fields;
  if (!fields) throw new Error('Pas de champs dans la réponse Mindee');

  const store = fields.supplier_name?.value || '';
  let date = '';
  if (fields.date?.value) {
    try { const d = new Date(fields.date.value); if (!isNaN(d)) date = d.toISOString().split('T')[0]; } catch {}
  }
  // Use the LARGEST of total_amount, or total_net + total_tax (to include taxes)
  const totalAmt = parseFloat(fields.total_amount?.value ?? 0) || 0;
  const totalNet = parseFloat(fields.total_net?.value  ?? 0) || 0;
  const totalTax = parseFloat(fields.total_tax?.value  ?? 0) || 0;
  const total = Math.max(totalAmt, totalNet + totalTax, totalNet);
  const items = (fields.line_items?.items || [])
    .filter(i => i.fields?.description?.value?.trim())
    .map(i => ({
      name:     i.fields.description.value.trim(),
      price:    parseFloat(i.fields.total_price?.value ?? i.fields.unit_price?.value ?? 0) || 0,
      quantity: parseFloat(i.fields.quantity?.value ?? 1) || 1,
      category: categorize(i.fields.description.value),
    }))
    .filter(i => i.name.length > 0);

  return { store, date, total, items };
}

/* ── ANALYZE — supports 1 to 4 photos ── */
app.post('/api/analyze', auth, async (req, res) => {
  try {
    // Accept single image OR array of images
    const rawImages = req.body.images || (req.body.imageBase64 ? [req.body.imageBase64] : []);
    if (!rawImages.length) return res.status(400).json({ error: 'Aucune image fournie' });

    const buffers = rawImages.map(img => {
      const m = img.match(/^data:[^;]+;base64,(.+)$/);
      return Buffer.from(m ? m[1] : img, 'base64');
    });

    console.log(`Analyzing ${buffers.length} image(s)...`);

    // Analyze all images in parallel
    const results = await Promise.all(buffers.map(analyzeOneImage));

    // Merge: store & date from first result that has them, total from max, items from all
    let store = results.find(r => r.store)?.store || 'Magasin inconnu';
    let date  = results.find(r => r.date)?.date  || new Date().toISOString().split('T')[0];
    let total = Math.max(...results.map(r => r.total));
    let items = results.flatMap(r => r.items);

    // Smart deduplication for overlapping photos
    // Two items are duplicates if: same price AND (same name OR one name contains the other OR very similar names)
    function editDistance(a, b) {
      const m = [], al = a.length, bl = b.length;
      for (let i = 0; i <= bl; i++) m[i] = [i];
      for (let j = 0; j <= al; j++) m[0][j] = j;
      for (let i = 1; i <= bl; i++)
        for (let j = 1; j <= al; j++)
          m[i][j] = b[i-1] === a[j-1] ? m[i-1][j-1] : Math.min(m[i-1][j-1], m[i][j-1], m[i-1][j]) + 1;
      return m[bl][al];
    }

    function isDuplicate(a, b) {
      if (Math.abs(a.price - b.price) > 0.01) return false; // prix différent = article différent
      const na = a.name.toUpperCase().trim();
      const nb = b.name.toUpperCase().trim();
      if (na === nb) return true; // nom identique exact

      // Troncature : un nom est le début de l'autre (photo mal cadrée)
      // Condition : le nom court doit faire au moins 10 chars pour éviter les faux positifs
      const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
      if (shorter.length >= 10 && longer.startsWith(shorter)) return true;

      // Très proche (variance OCR, 1-2 caractères) — seulement si noms longs (≥8 chars)
      if (na.length >= 8 && nb.length >= 8 && editDistance(na, nb) <= 2) return true;

      return false;
    }

    items = items.filter((item, idx) =>
      !items.slice(0, idx).some(prev => isDuplicate(prev, item))
    );

    if (items.length === 0) {
      return res.status(422).json({ success: false, error: 'Aucun article détecté. Assurez-vous que les articles sont visibles sur la photo.' });
    }

    console.log(`✅ Mindee merged: ${store} | ${date} | ${total}€ | ${items.length} articles`);
    res.json({ success: true, data: { store, date, total, items } });

  } catch (e) {
    console.error('Mindee error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ── RECEIPTS ── */
app.post('/api/receipts', auth, (req, res) => {
  const list = loadRec(req.user.id);
  const rec  = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString() };
  list.push(rec); saveRec(req.user.id, list);
  res.json({ success: true, data: rec });
});

app.get('/api/receipts',        auth, (req, res) => res.json(loadRec(req.user.id)));
app.delete('/api/receipts/:id', auth, (req, res) => { saveRec(req.user.id, loadRec(req.user.id).filter(r => r.id !== req.params.id)); res.json({ success: true }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ ReceiptIQ v3 (Mindee) → http://localhost:${PORT}`);
  if (!process.env.MINDEE_API_KEY) console.warn('⚠️  MINDEE_API_KEY manquante → https://platform.mindee.com/api-key');
});
