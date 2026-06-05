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

/* ── ANALYZE (Mindee specialized receipt OCR) ── */
app.post('/api/analyze', auth, upload.single('image'), async (req, res) => {
  try {
    let imgBuffer;
    if (req.file) {
      imgBuffer = req.file.buffer;
    } else if (req.body.imageBase64) {
      const m = req.body.imageBase64.match(/^data:[^;]+;base64,(.+)$/);
      imgBuffer = Buffer.from(m ? m[1] : req.body.imageBase64, 'base64');
    } else {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    // ── Step 1: Submit to Mindee v2 API ──
    const MINDEE_MODEL_ID = 'fee72ca6-432d-4e5f-afc4-0fbaa2a0e518';
    const form = new FormData();
    form.append('document', imgBuffer, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

    const submitRes = await fetch(`https://api.mindee.net/v2/inferences/${MINDEE_MODEL_ID}`, {
      method: 'POST',
      headers: { 'Authorization': `Token ${process.env.MINDEE_API_KEY}`, ...form.getHeaders() },
      body: form,
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      console.error('Mindee submit error:', submitRes.status, errText);
      throw new Error(`Mindee ${submitRes.status}: ${errText}`);
    }

    const submitJson = await submitRes.json();
    console.log('Mindee response keys:', Object.keys(submitJson));

    // ── Step 2: Extract fields (handle both sync and async responses) ──
    let fields;
    if (submitJson.inference?.result?.fields) {
      // Synchronous result
      fields = submitJson.inference.result.fields;
    } else if (submitJson.job?.result?.document?.inference?.result?.fields) {
      // Async job result
      fields = submitJson.job.result.document.inference.result.fields;
    } else if (submitJson.document?.inference?.result?.fields) {
      fields = submitJson.document.inference.result.fields;
    } else {
      // Poll for result if job is still processing
      const jobId = submitJson.job?.id || submitJson.id;
      if (!jobId) {
        console.error('Unexpected Mindee response:', JSON.stringify(submitJson).slice(0, 500));
        throw new Error('Format de réponse Mindee inattendu');
      }
      // Poll up to 10 times
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const pollRes = await fetch(`https://api.mindee.net/v2/inferences/${jobId}`, {
          headers: { 'Authorization': `Token ${process.env.MINDEE_API_KEY}` }
        });
        const pollJson = await pollRes.json();
        const status = pollJson.job?.status || pollJson.status;
        if (status === 'processed' || status === 'completed') {
          fields = pollJson.job?.result?.document?.inference?.result?.fields
                || pollJson.inference?.result?.fields
                || pollJson.document?.inference?.result?.fields;
          break;
        }
        if (status === 'failed') throw new Error('Mindee processing failed');
      }
    }

    if (!fields) throw new Error('Impossible de récupérer les données du ticket');

    // ── Step 3: Parse fields ──
    const store = fields.supplier_name?.value || fields.store_name?.value || 'Magasin inconnu';

    let date = new Date().toISOString().split('T')[0];
    const rawDate = fields.date?.value;
    if (rawDate) {
      try { const d = new Date(rawDate); if (!isNaN(d)) date = d.toISOString().split('T')[0]; } catch {}
    }

    const total = parseFloat(fields.total_amount?.value ?? fields.total?.value ?? 0) || 0;

    const rawItems = fields.line_items?.values || fields.line_items || [];
    let items = rawItems
      .filter(i => (i.description?.value || i.description)?.trim())
      .map(i => {
        const name  = (i.description?.value || i.description || '').trim();
        const price = parseFloat(i.total_amount?.value ?? i.unit_price?.value ?? i.total_amount ?? i.unit_price ?? 0) || 0;
        const qty   = parseFloat(i.quantity?.value ?? i.quantity ?? 1) || 1;
        return { name, price, quantity: qty, category: categorize(name) };
      })
      .filter(i => i.name.length > 0);

    if (items.length === 0) {
      return res.status(422).json({ success: false, error: 'Aucun article détecté. Prenez la photo plus près et réessayez.' });
    }

    console.log(`✅ Mindee: ${store} | ${date} | ${total}€ | ${items.length} articles`);
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
