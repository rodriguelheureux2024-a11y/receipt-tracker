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

const PROMPT = `Tu es un expert comptable spécialisé dans l'analyse de tickets de caisse.
Lis ATTENTIVEMENT chaque ligne de ce ticket et extrais les données en JSON valide.

IMPORTANT : Réponds UNIQUEMENT avec le JSON ci-dessous, AUCUN texte avant ou après.

{
  "store": "Nom exact du magasin (ex: Carrefour, Leclerc, Lidl, Aldi, Intermarché...)",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "items": [
    {
      "name": "Nom complet du produit tel qu'écrit",
      "price": 0.00,
      "quantity": 1,
      "category": "UNE des catégories ci-dessous"
    }
  ]
}

CATÉGORIES (utilise exactement ce texte) :
- "Fruits" → pommes, bananes, oranges, raisins, fraises, cerises, poires...
- "Légumes" → carottes, tomates, salade, courgettes, poireaux, champignons...
- "Viandes & Poissons" → poulet, bœuf, porc, saumon, thon, jambon, charcuterie...
- "Produits Laitiers" → lait, yaourt, fromage, beurre, crème fraîche, œufs...
- "Boulangerie & Pâtisserie" → pain, baguette, gâteau, croissant, brioche...
- "Boissons" → eau, jus, soda, café, thé, vin, bière, sirop...
- "Épicerie Sèche" → pâtes, riz, farine, conserves, céréales, huile, vinaigre...
- "Surgelés" → tout produit surgelé ou congelé
- "Hygiène & Beauté" → shampoing, savon, dentifrice, déodorant, maquillage...
- "Entretien Maison" → lessive, produit ménager, éponge, papier toilette...
- "Santé" → médicaments, vitamines, compléments alimentaires...
- "Snacks & Confiseries" → chips, bonbons, chocolat, biscuits, gâteaux apéritifs...
- "Autres" → tout ce qui ne rentre pas dans les catégories précédentes

RÈGLES :
- Lis TOUTES les lignes du ticket, ne rate aucun article
- price = prix payé pour cette ligne entière
- Si vendu au poids (ex: 0.450 kg × 5.99€/kg), calcule le prix total
- Ne confonds pas une remise/promotion avec un article
- date = date sur le ticket au format YYYY-MM-DD (si illisible, mets ${new Date().toISOString().split('T')[0]})
- total = montant total payé (TTC)`;

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
      model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
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
