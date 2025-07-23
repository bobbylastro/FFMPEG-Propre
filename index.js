const express = require('express');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(express.json());

app.post('/create-video', async (req, res) => {
  const { images } = req.body;

  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Aucune image fournie' });
  }

  try {
    const tempDir = path.join(__dirname, 'temp', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    const downloadPromises = images.map(async (url, i) => {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const fileName = `img${String(i + 1).padStart(3, '0')}.jpg`;
      const filePath = path.join(tempDir, fileName);
      await fs.writeFile(filePath, response.data);
      return filePath;
    });

    await Promise.all(downloadPromises);

    const outputVideoPath = path.join(tempDir, 'output.mp4');

    ffmpeg()
      .input(path.join(tempDir, 'img%03d.jpg'))
      .inputOptions(['-framerate 1/3'])
      .outputOptions(['-c:v libx264', '-r 30', '-pix_fmt yuv420p'])
      .output(outputVideoPath)
      .on('end', () => {
        res.download(outputVideoPath, 'video.mp4', (err) => {
          if (err) {
            console.error('Erreur lors de l’envoi de la vidéo', err);
          }
        });
        // Supprime le dossier seulement après que la réponse ait fini d’être envoyée
        res.on('finish', async () => {
          await fs.rm(tempDir, { recursive: true, force: true });
        });
      })
      .on('error', async (err) => {
        console.error('Erreur ffmpeg :', err);
        await fs.rm(tempDir, { recursive: true, force: true });
        res.status(500).json({ error: 'Erreur lors de la création de la vidéo' });
      })
      .run();

  } catch (error) {
    console.error('Erreur serveur :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
