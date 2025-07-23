const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(express.json());

// Fonction pour télécharger une image depuis une URL et la sauvegarder localement
const downloadImage = async (url, filepath) => {
  const writer = fs.createWriteStream(filepath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
};

app.post('/create-video', async (req, res) => {
  const { images } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Aucune image fournie' });
  }

  try {
    // Créer le dossier temp s'il n'existe pas
    const tempDir = path.resolve(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    // Télécharger toutes les images
    const downloadPromises = images.map((url, index) => {
      const filepath = path.join(tempDir, `image_${index}.jpg`);
      return downloadImage(url, filepath);
    });

    await Promise.all(downloadPromises);

    res.json({ message: 'Images téléchargées avec succès' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors du téléchargement des images' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
