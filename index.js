const express = require('express');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(express.json());

// Fonction utilitaire pour obtenir la durée de l'audio
const getAudioDuration = (audioPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
};

// Expose le dossier public
app.use('/videos', express.static(path.join(__dirname, 'public/videos')));

app.post('/create-video', async (req, res) => {
  const { images, audioUrl } = req.body;

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Aucune image fournie.' });
  }

  const videosDir = path.join(__dirname, 'public/videos');
  const tempDir = path.join(__dirname, 'temp', Date.now().toString());

  try {
    // Nettoyer les anciennes vidéos
    await fs.mkdir(videosDir, { recursive: true });
    const existingFiles = await fs.readdir(videosDir);
    await Promise.all(existingFiles
      .filter(f => f.endsWith('.mp4'))
      .map(f => fs.unlink(path.join(videosDir, f)))
    );

    // Créer le dossier temporaire
    await fs.mkdir(tempDir, { recursive: true });

    // Télécharger les images
    const imagePaths = await Promise.all(images.map(async (url, index) => {
      const fileName = `img${String(index + 1).padStart(3, '0')}.jpg`;
      const filePath = path.join(tempDir, fileName);
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      await fs.writeFile(filePath, response.data);
      return filePath;
    }));

    // Télécharger l’audio
    let audioPath = null;
    let secondsPerImage = 8; // Valeur par défaut

    if (audioUrl) {
      const audioData = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      audioPath = path.join(tempDir, 'audio.mp3');
      await fs.writeFile(audioPath, audioData.data);

      // Récupérer la durée de l’audio et calculer la durée par image
      const audioDuration = await getAudioDuration(audioPath);
      secondsPerImage = audioDuration / images.length;

      // Optionnel : limite raisonnable
      secondsPerImage = Math.max(1, Math.min(secondsPerImage, 20));
    }

    // Créer la vidéo avec ffmpeg
    const outputFileName = `video_${Date.now()}.mp4`;
    const outputVideoPath = path.join(videosDir, outputFileName);

    await new Promise((resolve, reject) => {
      let command = ffmpeg()
        .input(path.join(tempDir, 'img%03d.jpg'))
        .inputOptions([`-framerate 1/${secondsPerImage}`]);

      if (audioPath) {
        command = command.input(audioPath);
      }

      command
        .outputOptions([
          '-c:v libx264',
          '-r 30',
          '-pix_fmt yuv420p',
          ...(audioPath ? ['-shortest'] : [])
        ])
        .output(outputVideoPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Nettoyer les fichiers temporaires
    await fs.rm(tempDir, { recursive: true, force: true });

    const videoUrl = `${req.protocol}://${req.get('host')}/videos/${outputFileName}`;
    res.json({ videoUrl });

  } catch (error) {
    console.error('Erreur lors de la génération de la vidéo :', error);
    res.status(500).json({ error: 'Erreur serveur' });

    // En cas d’erreur, on tente quand même de nettoyer le dossier temporaire
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('Erreur de nettoyage du dossier temporaire :', cleanupErr.message);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
