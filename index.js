const express = require('express');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(express.json());

// Expose le dossier public pour que les fichiers soient accessibles via URL
app.use('/videos', express.static(path.join(__dirname, 'public/videos')));

app.post('/create-video', async (req, res) => {
  const { images } = req.body;

  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Aucune image fournie' });
  }

  try {
    // Supprimer les anciennes vidéos dans public/videos
    const videosDir = path.join(__dirname, 'public/videos');
    try {
      const files = await fs.readdir(videosDir);
      for (const file of files) {
        if (file.endsWith('.mp4')) {
          await fs.unlink(path.join(videosDir, file));
        }
      }
      console.log('Anciennes vidéos supprimées');
    } catch (err) {
      // Si le dossier n’existe pas encore ou autre erreur, on ignore
      console.warn('Aucune vidéo à supprimer ou erreur:', err.message);
    }

    const tempDir = path.join(__dirname, 'temp', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    const downloadPromises = images.map(async (url, i) => {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const fileName = img${String(i + 1).padStart(3, '0')}.jpg;
      const filePath = path.join(tempDir, fileName);
      await fs.writeFile(filePath, response.data);
      return filePath;
    });

    await Promise.all(downloadPromises);

    const outputFileName = video_${Date.now()}.mp4;
    const outputVideoPath = path.join(__dirname, 'public/videos', outputFileName);

    await fs.mkdir(path.dirname(outputVideoPath), { recursive: true });

    // Créer la vidéo avec ffmpeg (1 image toutes les 5 secondes)
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(tempDir, 'img%03d.jpg'))
        .inputOptions(['-framerate 1/5'])
        .outputOptions(['-c:v libx264', '-r 30', '-pix_fmt yuv420p'])
        .output(outputVideoPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Nettoyer le temp
    await fs.rm(tempDir, { recursive: true, force: true });

    // Renvoie l'URL publique de la vidéo
    const videoUrl = ${req.protocol}://${req.get('host')}/videos/${outputFileName};
    res.json({ videoUrl });

  } catch (error) {
    console.error('Erreur serveur :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(Serveur lancé sur le port ${PORT});
});
