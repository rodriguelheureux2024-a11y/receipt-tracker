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
  const brand = brandCategorize(name);
  if (brand) return brand;
  const n = name.toUpperCase();
  if (/APPLE|BANANA|ORANGE|BERRY|GRAPE|MANGO|PEACH|PEAR|PLUM|CHERRY|LEMON|LIME|MELON|KIWI|PINEAPPLE|APRICOT|CARA CARA|CLEMENTINE|TANGERINE|GRAPEFRUIT|POMELO|JACKFRUIT|PAPAYA|GUAVA|PASSION FRUIT|POMME|BANANE|FRAISE|FRAMBOISE|BLEUET|RAISIN|MANGUE|PECHE|PÊCHE|POIRE|PRUNE|CERISE|CITRON|ANANAS|ABRICOT|CLEMENTINE|CLÉMENTINE|PAMPLEMOUSSE|CANTALOUP|PASTEQUE|PASTÈQUE/.test(n)) return 'Fruits';
  if (/ONION|GARLIC|TOMATO|CARROT|LETTUCE|SPINACH|BROCCOLI|PEPPER|GINGER|POTATO|MUSHROOM|ZUCCHINI|CELERY|KALE|CUCUMBER|CABBAGE|CAULIFLOWER|ASPARAGUS|BEET|RADISH|TURNIP|YAM|SQUASH|FENNEL|LEEK|ARUGULA|CHARD|ARTICHOKE|WATERCRESS|ENDIVE|OIGNON|TOMATE|CAROTTE|LAITUE|EPINARD|ÉPINARD|BROCOLI|POIVRON|GINGEMBRE|PATATE|CHAMPIGNON|COURGETTE|CELERI|CÉLERI|CHOU|CONCOMBRE|ASPERGE|BETTERAVE|RADIS|NAVET|COURGE|FENOUIL|POIREAU|ROQUETTE|ARTICHAUT|MAIS|MAÏS/.test(n)) return 'Légumes';
  if (/BEEF|CHICKEN|PORK|LAMB|FISH|SALMON|COD|TUNA|SHRIMP|CRAB|FILLET|STEAK|GROUND|TURKEY|DUCK|BACON|HAM|SAUSAGE|SALAMI|TILAPIA|TROUT|HALIBUT|SEAFOOD|SCALLOP|MUSSEL|OYSTER|LOBSTER|MEAT|LEAN|SIRLOIN|TENDERLOIN|BOEUF|BŒUF|POULET|PORC|AGNEAU|POISSON|SAUMON|MORUE|THON|CREVETTE|CRABE|HACHE|HACHÉ|DINDE|CANARD|JAMBON|SAUCISSE|TRUITE|FLETAN|FLÉTAN|HOMARD|VIANDE|VEAU|COTE|CÔTE|ROTI|RÔTI|AIGLEFIN/.test(n)) return 'Viandes & Poissons';
  if (/MILK|YOGURT|YOGHURT|CHEESE|BUTTER|CREAM|DAIRY|KEFIR|RICOTTA|MOZZARELLA|CHEDDAR|BRIE|PARMESAN|GOUDA|EGG|LAIT|YAOURT|YOGOURT|FROMAGE|BEURRE|CREME|CRÈME|OEUF|ŒUF/.test(n)) return 'Produits Laitiers';
  if (/BREAD|BAGUETTE|CROISSANT|PASTRY|CAKE|BAGEL|MUFFIN|ROLL|BRIOCHE|SOURDOUGH|LOAF|SCONE|WAFFLE|CRUMPET|PITA|TORTILLA|NAAN|PAIN|PATISSERIE|PÂTISSERIE|GATEAU|GÂTEAU|GAUFRE|BISCOTTE|GALETTE|TARTE|ECLAIR|ÉCLAIR/.test(n)) return 'Boulangerie & Pâtisserie';
  if (/WATER|JUICE|SODA|COFFEE|TEA|WINE|BEER|CIDER|LEMONADE|KOMBUCHA|SPARKLING|BEVERAGE|DRINK|COCONUT WATER|ALMOND MILK|OAT MILK|SOY MILK|MATCHA|ESPRESSO|JUS|CAFE|CAFÉ|THÉ|BIERE|BIÈRE|CIDRE|LIMONADE|BOISSON|TISANE/.test(n)) return 'Boissons';
  if (/FLOUR|GRAIN|CEREAL|PASTA|RICE|ALMOND|NUT|SEED|COUSCOUS|MILLET|TOFU|OATS|QUINOA|LENTIL|BEAN|OIL|VINEGAR|SAUCE|HONEY|JAM|SYRUP|PEANUT|TAHINI|HUMMUS|SALSA|KETCHUP|MUSTARD|MAYO|SPICE|SALT|SUGAR|BUCKWHEAT|SUNFLOWER|CHIA|FLAX|HEMP|CANNED|CONSERVE|BROTH|STOCK|NOODLE|SPAGHETTI|MACARONI|FARINE|CEREALE|CÉRÉALE|PATES|PÂTES|RIZ|AMANDE|NOIX|GRAINE|AVOINE|QUINOA|LENTILLE|HARICOT|HUILE|VINAIGRE|MIEL|CONFITURE|SIROP|ARACHIDE|HOUMOUS|KETCHUP|MOUTARDE|SEL|SUCRE|SARRASIN|TOURNESOL|BOUILLON|SOUPE|NOUILLE|\bCRL\b|\bMLLS\b|\bWHT\b|\bWHL\b|UNBLCHD|HERITAGE|SPROUTED|ORGANIC FLOUR|ORG FLOUR/.test(n)) return 'Épicerie Sèche';
  if (/FROZEN|ICE CREAM|SORBET|GELATO|SURGELE|SURGELÉ|CONGELE|CONGELÉ|GLACE/.test(n)) return 'Surgelés';
  if (/SHAMPOO|CONDITIONER|SOAP|BODY WASH|TOOTHPASTE|DEODORANT|LOTION|MOISTURIZER|SUNSCREEN|RAZOR|MAKEUP|LIPSTICK|MASCARA|PERFUME|COLOGNE|SHAMPOOING|SAVON|DENTIFRICE|DEODORANT|DÉODORANT|RASOIR|PARFUM/.test(n)) return 'Hygiène & Beauté';
  if (/DETERGENT|LAUNDRY|CLEANER|SPONGE|PAPER TOWEL|TOILET PAPER|BLEACH|DISH SOAP|TRASH BAG|LESSIVE|NETTOYANT|EPONGE|ÉPONGE|ESSUIE-TOUT|PAPIER TOILETTE|PAPIER WC|JAVEL|SAVON VAISSELLE|SAC POUBELLE/.test(n)) return 'Entretien Maison';
  if (/VITAMIN|SUPPLEMENT|MEDICINE|TABLET|CAPSULE|ADVIL|TYLENOL|IBUPROFEN|ASPIRIN|BANDAGE|VITAMINE|MEDICAMENT|MÉDICAMENT|COMPRIME|COMPRIMÉ/.test(n)) return 'Santé';
  if (/CHIP|COOKIE|CHOCOLATE|CANDY|SNACK|CRACKER|PRETZEL|POPCORN|GRANOLA BAR|BROWNIE|GUMMY|MARSHMALLOW|CROUSTILLE|BISCUIT|CHOCOLAT|BONBON|COLLATION|CHIPS|GUIMAUVE/.test(n)) return 'Snacks & Confiseries';
  return 'Autres';
}

/* ── BRAND DATABASE (gratuit, aucune API) ── */
const BRAND_MAP = {
  // Produits Laitiers
  'CHOBANI':'Produits Laitiers','DANONE':'Produits Laitiers','ACTIVIA':'Produits Laitiers',
  'OIKOS':'Produits Laitiers','LIBERTE':'Produits Laitiers','LIBERTÉ':'Produits Laitiers',
  'YOPLAIT':'Produits Laitiers','SIGGI':'Produits Laitiers','FAGE':'Produits Laitiers',
  'STONEYFIELD':'Produits Laitiers','BEATRICE':'Produits Laitiers','NATREL':'Produits Laitiers',
  'LACTANTIA':'Produits Laitiers','PHILADELPHIA':'Produits Laitiers','BABYBEL':'Produits Laitiers',
  'BOURSIN':'Produits Laitiers','PRÉSIDENT':'Produits Laitiers','PRESIDENT':'Produits Laitiers',
  'ARMSTRONG':'Produits Laitiers','BALDERSON':'Produits Laitiers','CRACKER BARREL':'Produits Laitiers',
  // Boissons
  'SIMPLY':'Boissons','SIMPLYBEVERG':'Boissons','TROPICANA':'Boissons','MINUTE MAID':'Boissons',
  'GATORADE':'Boissons','POWERADE':'Boissons','ARIZONA':'Boissons','SNAPPLE':'Boissons',
  'RED BULL':'Boissons','MONSTER':'Boissons','ROCKSTAR':'Boissons',
  'NESPRESSO':'Boissons','STARBUCKS':'Boissons','LIPTON':'Boissons','NESTEA':'Boissons',
  'PERRIER':'Boissons','EVIAN':'Boissons','DASANI':'Boissons','SMARTWATER':'Boissons',
  'CERES':'Boissons','OASIS':'Boissons','CLAMATO':'Boissons','V8':'Boissons',
  'BIGELOW':'Boissons','CELESTIAL':'Boissons','TETLEY':'Boissons','NABOB':'Boissons',
  'FOLGERS':'Boissons','MAXWELL':'Boissons','TIM HORTONS':'Boissons',
  // Épicerie Sèche
  'KASHI':'Épicerie Sèche','KELLOGG':'Épicerie Sèche','QUAKER':'Épicerie Sèche',
  'GENERAL MILLS':'Épicerie Sèche','CHEERIOS':'Épicerie Sèche','POST':'Épicerie Sèche',
  'CENTO':'Épicerie Sèche','HEINZ':'Épicerie Sèche','CAMPBELL':'Épicerie Sèche',
  'PROGRESSO':'Épicerie Sèche','DOLE':'Épicerie Sèche','DEL MONTE':'Épicerie Sèche',
  'CLASSICO':'Épicerie Sèche','RAGU':'Épicerie Sèche','PREGO':'Épicerie Sèche',
  'BARILLA':'Épicerie Sèche','CATELLI':'Épicerie Sèche','RIZONI':'Épicerie Sèche',
  'UNCLE BEN':'Épicerie Sèche','KNORR':'Épicerie Sèche','MAGGI':'Épicerie Sèche',
  'PRESIDENT CHOICE':'Épicerie Sèche','PC':'Épicerie Sèche','STORE BRAND':'Épicerie Sèche',
  'SKIPPY':'Épicerie Sèche','JIF':'Épicerie Sèche','SMUCKER':'Épicerie Sèche',
  'HELLMANN':'Épicerie Sèche','KRAFT':'Épicerie Sèche','FRENCH':'Épicerie Sèche',
  'OLD EL PASO':'Épicerie Sèche','TACO BELL':'Épicerie Sèche','ORTEGA':'Épicerie Sèche',
  'COCONUT':'Épicerie Sèche','SILK':'Épicerie Sèche','BLUE DIAMOND':'Épicerie Sèche',
  // Viandes & Poissons
  'MAPLE LEAF':'Viandes & Poissons','SCHNEIDERS':'Viandes & Poissons','OLYMEL':'Viandes & Poissons',
  'BUTTERBALL':'Viandes & Poissons','OSCAR MAYER':'Viandes & Poissons','JOHNSONVILLE':'Viandes & Poissons',
  'BUMBLE BEE':'Viandes & Poissons','STARKIST':'Viandes & Poissons','CHICKEN OF THE SEA':'Viandes & Poissons',
  'HIGH LINER':'Viandes & Poissons','GORTON':'Viandes & Poissons',
  // Snacks & Confiseries
  'LAYS':'Snacks & Confiseries','LAY\'S':'Snacks & Confiseries','DORITOS':'Snacks & Confiseries',
  'PRINGLES':'Snacks & Confiseries','RUFFLES':'Snacks & Confiseries','CHEETOS':'Snacks & Confiseries',
  'OREO':'Snacks & Confiseries','CHIPS AHOY':'Snacks & Confiseries','RITZ':'Snacks & Confiseries',
  'TRISCUIT':'Snacks & Confiseries','KIND':'Snacks & Confiseries','CLIF':'Snacks & Confiseries',
  'REESE':'Snacks & Confiseries','SNICKERS':'Snacks & Confiseries','MARS':'Snacks & Confiseries',
  'KITKAT':'Snacks & Confiseries','KIT KAT':'Snacks & Confiseries','TWIX':'Snacks & Confiseries',
  'HERSHEY':'Snacks & Confiseries','LINDT':'Snacks & Confiseries','TOBLERONE':'Snacks & Confiseries',
  'FERRERO':'Snacks & Confiseries','NUTELLA':'Snacks & Confiseries','PEPPERIDGE':'Snacks & Confiseries',
  'GOLDFISH':'Snacks & Confiseries','PLANTERS':'Snacks & Confiseries','NATURE VALLEY':'Snacks & Confiseries',
  'GRANOLA BAR':'Snacks & Confiseries','CRISPERS':'Snacks & Confiseries','OLD DUTCH':'Snacks & Confiseries',
  // Boulangerie & Pâtisserie
  'WONDER':'Boulangerie & Pâtisserie','DEMPSTER':'Boulangerie & Pâtisserie','VILLAGGIO':'Boulangerie & Pâtisserie',
  'SILVER HILLS':'Boulangerie & Pâtisserie','DAVE\'S':'Boulangerie & Pâtisserie','THOMAS':'Boulangerie & Pâtisserie',
  'PEPPERIDGE FARM':'Boulangerie & Pâtisserie','ARNOLD':'Boulangerie & Pâtisserie',
  // Surgelés
  'MCCAIN':'Surgelés','BIRD EYE':'Surgelés','BIRDSEYE':'Surgelés','STOUFFER':'Surgelés',
  'LEAN CUISINE':'Surgelés','HEALTHY CHOICE':'Surgelés','SWANSON':'Surgelés',
  'AMY\'S':'Surgelés','AMYS':'Surgelés','MORNING STAR':'Surgelés','GARDEIN':'Surgelés',
  // Hygiène & Beauté
  'DOVE':'Hygiène & Beauté','NIVEA':'Hygiène & Beauté','OLAY':'Hygiène & Beauté',
  'NEUTROGENA':'Hygiène & Beauté','PANTENE':'Hygiène & Beauté','HEAD & SHOULDERS':'Hygiène & Beauté',
  'GARNIER':'Hygiène & Beauté','LOREAL':'Hygiène & Beauté','L\'OREAL':'Hygiène & Beauté',
  'COLGATE':'Hygiène & Beauté','CREST':'Hygiène & Beauté','GILLETTE':'Hygiène & Beauté',
  'SCHICK':'Hygiène & Beauté','AXE':'Hygiène & Beauté','OLD SPICE':'Hygiène & Beauté',
  'SPEED STICK':'Hygiène & Beauté','DEGREE':'Hygiène & Beauté','SECRET':'Hygiène & Beauté',
  'CETAPHIL':'Hygiène & Beauté','AVEENO':'Hygiène & Beauté','VASELINE':'Hygiène & Beauté',
  // Entretien Maison
  'TIDE':'Entretien Maison','GAIN':'Entretien Maison','DOWNY':'Entretien Maison',
  'BOUNCE':'Entretien Maison','LYSOL':'Entretien Maison','AJAX':'Entretien Maison',
  'MR CLEAN':'Entretien Maison','WINDEX':'Entretien Maison','PLEDGE':'Entretien Maison',
  'BOUNTY':'Entretien Maison','CHARMIN':'Entretien Maison','SCOTTIES':'Entretien Maison',
  'GLAD':'Entretien Maison','ZIPLOC':'Entretien Maison','CASCADE':'Entretien Maison',
  'DAWN':'Entretien Maison','PALMOLIVE':'Entretien Maison','SUNLIGHT':'Entretien Maison',
  // Santé
  'CENTRUM':'Santé','NATURE MADE':'Santé','JAMIESON':'Santé','VICKS':'Santé',
  'HALLS':'Santé','PEPTO':'Santé','TUMS':'Santé','ROLAIDS':'Santé',
  // Abréviations Whole Foods / épiceries bio
  'NPA':'Épicerie Sèche','NATURES PATH':'Épicerie Sèche',"NATURE'S PATH":'Épicerie Sèche',
  'BRM':'Épicerie Sèche','BOBS RED MILL':'Épicerie Sèche',"BOB'S RED MILL":'Épicerie Sèche',
  'EDN':'Épicerie Sèche','EDEN':'Épicerie Sèche','EDEN FOODS':'Épicerie Sèche',
  '365WFM':'Épicerie Sèche','365':'Épicerie Sèche','WFM':'Épicerie Sèche',
  'ANNIES':'Snacks & Confiseries',"ANNIE'S":'Snacks & Confiseries',
  'CASCADIAN':'Épicerie Sèche','ARROWHEAD':'Épicerie Sèche','MUIR GLEN':'Épicerie Sèche',
  'PACIFIC FOODS':'Épicerie Sèche','IMAGINE':'Épicerie Sèche',
  'BRAGG':'Épicerie Sèche','PRIMAL KITCHEN':'Épicerie Sèche',
  'CHOSEN FOODS':'Épicerie Sèche','SPECTRUM':'Épicerie Sèche','HAIN':'Épicerie Sèche',
  // Laitiers bio / végétal
  'ORGANIC VALLEY':'Produits Laitiers','HORIZON':'Produits Laitiers',
  'STONYFIELD':'Produits Laitiers','EARTH BALANCE':'Produits Laitiers',
  'DAIYA':'Produits Laitiers','VIOLIFE':'Produits Laitiers','MIYOKO':'Produits Laitiers',
  'KITE HILL':'Produits Laitiers','FOLLOW YOUR HEART':'Produits Laitiers',
  // Boissons végétales
  'OATLY':'Boissons','CALIFIA':'Boissons','RIPPLE':'Boissons',
  'SILK':'Boissons','DREAM':'Boissons','SO DELICIOUS':'Boissons',
  // Protéines végétales
  'BEYOND':'Viandes & Poissons','IMPOSSIBLE':'Viandes & Poissons',
  'TOFURKY':'Viandes & Poissons','LIGHTLIFE':'Viandes & Poissons',
  'FIELD ROAST':'Viandes & Poissons','GARDEIN':'Viandes & Poissons',
};

function brandCategorize(name) {
  const n = name.toUpperCase().trim().replace(/['']/g, "'");
  for (const [brand, cat] of Object.entries(BRAND_MAP)) {
    if (n === brand || n.startsWith(brand + ' ') || n.startsWith(brand + '-')) return cat;
  }
  return null;
}

/* ── MISTRAL CLASSIFICATION ── */
const VALID_CATEGORIES = ['Fruits','Légumes','Viandes & Poissons','Produits Laitiers','Boulangerie & Pâtisserie','Boissons','Épicerie Sèche','Surgelés','Hygiène & Beauté','Entretien Maison','Santé','Snacks & Confiseries','Autres'];

const MISTRAL_PROMPT = `You are an expert grocery store receipt classifier. Items can be brand names, abbreviated codes, or product descriptions in English, French, or any language.

Categories: Fruits, Légumes, Viandes & Poissons, Produits Laitiers, Boulangerie & Pâtisserie, Boissons, Épicerie Sèche, Surgelés, Hygiène & Beauté, Entretien Maison, Santé, Snacks & Confiseries, Autres

Classification examples:
- "CHOBANI" → "Produits Laitiers" (yogurt brand)
- "OIKOS" → "Produits Laitiers" (yogurt brand)
- "KASHI" → "Épicerie Sèche" (cereal brand)
- "NPA HERITAGE CRL OG" → "Épicerie Sèche" (Nature's Path organic cereal)
- "BRM OG UNBLCHD WT" → "Épicerie Sèche" (Bob's Red Mill organic flour)
- "EDN OG WHL GRN MILL" → "Épicerie Sèche" (Eden organic whole grain)
- "365WFM OG ALMONDS" → "Épicerie Sèche" (Whole Foods organic almonds)
- "SIMPLYBEVERG" or "SIMPLY" → "Boissons" (Simply beverages brand)
- "CENTO" → "Épicerie Sèche" (Italian canned food brand)
- "LAYS" or "DORITOS" → "Snacks & Confiseries"
- "TIDE" or "GAIN" → "Entretien Maison" (detergent brands)
- "DOVE" or "NIVEA" → "Hygiène & Beauté"
- "POULET" or "BOEUF HACHE" → "Viandes & Poissons"
- "LAIT 2%" or "FROMAGE" → "Produits Laitiers"
- "PAIN" or "BAGUETTE" → "Boulangerie & Pâtisserie"
- "JUS" or "EAU GAZEUSE" → "Boissons"
- "BEYOND MEAT" → "Viandes & Poissons"
- "OATLY" → "Boissons" (oat milk brand)

Use "Autres" ONLY if truly impossible to classify.

Items to classify:
`;

async function categorizeWithMistral(names) {
  const apiKey = (process.env.MISTRAL_API_KEY || '').trim();
  if (!apiKey || !names.length) return names.map(() => null);
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        max_tokens: 1024,
        temperature: 0,
        messages: [{
          role: 'user',
          content: MISTRAL_PROMPT + names.map((n, i) => `${i + 1}. ${n}`).join('\n') + '\n\nReply ONLY with a valid JSON array of category strings, one per item, same order. No explanation.'
        }]
      })
    });
    if (!res.ok) { console.warn(`Mistral ${res.status}: ${await res.text()}`); return names.map(() => null); }
    const data = await res.json();
    const text = data.choices[0].message.content.trim();
    const match = text.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : text);
    return Array.isArray(parsed)
      ? parsed.map(c => VALID_CATEGORIES.includes(c) ? c : null)
      : names.map(() => null);
  } catch (e) {
    console.warn('Mistral failed:', e.message);
    return names.map(() => null);
  }
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
  // Compute tax: use explicit total_tax, or fall back to total_amount - total_net
  const tax = totalTax > 0 ? totalTax : Math.max(0, Math.round((totalAmt - totalNet) * 100) / 100);
  const items = (fields.line_items?.items || [])
    .filter(i => i.fields?.description?.value?.trim())
    .map(i => ({
      name:     i.fields.description.value.trim(),
      price:    parseFloat(i.fields.total_price?.value ?? i.fields.unit_price?.value ?? 0) || 0,
      quantity: parseFloat(i.fields.quantity?.value ?? 1) || 1,
      category: 'Autres',
    }))
    .filter(i => i.name.length > 0);

  // 1. Mistral classifie TOUS les articles en une seule requête
  if (items.length > 0) {
    const aiCats = await categorizeWithMistral(items.map(i => i.name));
    items.forEach((item, idx) => {
      item.category = aiCats[idx] || categorize(item.name);
    });
    const aiCount = aiCats.filter(c => c !== null).length;
    console.log(`🤖 Mistral: ${aiCount}/${items.length} articles classifiés`);
  }

  return { store, date, total, tax, items };
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
    const bestResult = results.find(r => r.total === total) || results[0];
    let tax   = bestResult.tax || 0;
    let items = results.flatMap(r => r.items);

    if (items.length === 0) {
      return res.status(422).json({ success: false, error: 'Aucun article détecté. Assurez-vous que les articles sont visibles sur la photo.' });
    }

    console.log(`✅ Mindee merged: ${store} | ${date} | ${total}€ (taxes: ${tax}€) | ${items.length} articles`);
    res.json({ success: true, data: { store, date, total, tax, items } });

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
