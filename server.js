const express = require('express');
const multer  = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const genAI  = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const DATA_FILE = path.join(__dirname, 'data', 'receipts.json');

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function load()     { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; } }
function save(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

const PROMPT = `Tu es un expert en analyse de tickets de caisse français/européens.
Analyse cette image et extrais toutes les informations en JSON strictement valide (pas de markdown, pas de texte autour).

Format attendu :
{
  "store": "nom du magasin",
  "date": "YYYY-MM-DD",
  "total": 12.34,
  "items": [
    { "name": "Nom produit", "price": 1.99, "quantity": 1, "category": "Catégorie" }
  ]
}

Catégories autorisées (choisis la plus pertinente) :
Fruits | Légumes | Viandes & Poissons | Produits Laitiers | Boulangerie & Pâtisserie |
Boissons | Épicerie Sèche | Surgelés | Hygiène & Beauté | Entretien Maison |
Santé | Snacks & Confiseries | Autres

Règles :
- date au format YYYY-MM-DD (aujourd'hui si illisible)
- price = prix total de la ligne (quantité × prix unitaire)
- quantity = 1 si non précisé
- Réponds UNIQUEMENT avec le JSON, rien d'autre`;

// Analyze (does NOT save — client confirms)
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

    const model  = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-8b' });
    const result = await model.generateContent([
      { inlineData: { mimeType: mediaType, data: imgData } },
      PROMPT
    ]);

    let text = result.response.text().trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    const data = JSON.parse(text);
    res.json({ success: true, data });

  } catch (err) {
    console.error('analyze error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save a confirmed receipt
app.post('/api/receipts', (req, res) => {
  const receipts = load();
  const receipt  = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString() };
  receipts.push(receipt);
  save(receipts);
  res.json({ success: true, data: receipt });
});

// Get all receipts
app.get('/api/receipts', (_req, res) => res.json(load()));

// Delete a receipt
app.delete('/api/receipts/:id', (req, res) => {
  save(load().filter(r => r.id !== req.params.id));
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ ReceiptIQ démarré → http://localhost:${PORT}`);
  if (!process.env.GOOGLE_API_KEY) {
    console.warn('\n⚠️  ATTENTION : variable GOOGLE_API_KEY non définie !');
    console.warn('   Obtenez une clé gratuite sur : https://aistudio.google.com/app/apikey\n');
  }
});
