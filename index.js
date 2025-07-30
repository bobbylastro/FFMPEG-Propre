const express = require('express');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(express.json());

// Fonction utilitaire pour obtenir la durée de l’audio
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
  console.log('📥 Requête reçue /create-video');
  const { images, audioUrl } = req.body;

  if (!Array.isArray(images) || images.length === 0) {
    console.warn('⚠️ Aucune image fournie');
    return res.status(400).json({ error: 'Aucune image fournie.' });
  }

  const videosDir = path.join(__dirname, 'public/videos');
  const tempDir = path.join(__dirname, 'temp', Date.now().toString());
  console.log(`📂 Dossier temporaire : ${tempDir}`);

  try {
    console.log('🧹 Nettoyage des anciennes vidéos...');
    await fs.mkdir(videosDir, { recursive: true });
    const existingFiles = await fs.readdir(videosDir);
    await Promise.all(existingFiles
      .filter(f => f.endsWith('.mp4'))
      .map(f => fs.unlink(path.join(videosDir, f)))
    );
    console.log('✅ Nettoyage terminé.');

    await fs.mkdir(tempDir, { recursive: true });

    // Télécharger les images
    console.log('⬇️ Téléchargement des images...');
    const imagePaths = [];
    for (let i = 0; i < images.length; i++) {
      const url = images[i];
      const fileName = `img${String(i + 1).padStart(3, '0')}.jpg`;
      const filePath = path.join(tempDir, fileName);

      console.log(`📸 Téléchargement image ${i + 1}: ${url}`);
      try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
        await fs.writeFile(filePath, response.data);
        imagePaths.push(filePath);
      } catch (err) {
        console.error(`❌ Erreur téléchargement image ${url}:`, err.message);
        return res.status(500).json({ error: `Erreur téléchargement de l'image ${url}` });
      }
    }
    console.log('✅ Toutes les images ont été téléchargées.');

    // Télécharger l’audio
    let audioPath = null;
    let secondsPerImage = 6;

    if (audioUrl) {
      console.log(`🎵 Téléchargement de l'audio: ${audioUrl}`);
      try {
        const audioData = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 15000 });
        audioPath = path.join(tempDir, 'audio.mp3');
        await fs.writeFile(audioPath, audioData.data);

        const audioDuration = await getAudioDuration(audioPath);
        secondsPerImage = audioDuration / images.length;
        secondsPerImage = Math.max(1, Math.min(secondsPerImage, 20));
        console.log(`✅ Audio téléchargé. Durée: ${audioDuration.toFixed(2)}s, Durée/image: ${secondsPerImage.toFixed(2)}s`);
      } catch (err) {
        console.error(`❌ Erreur téléchargement audio ${audioUrl}:`, err.message);
        return res.status(500).json({ error: `Erreur téléchargement de l'audio ${audioUrl}` });
      }
    }

    // Création de la vidéo
    const outputFileName = `video_${Date.now()}.mp4`;
    const outputVideoPath = path.join(videosDir, outputFileName);
    console.log(`🎬 Démarrage création de la vidéo : ${outputVideoPath}`);

    await new Promise((resolve, reject) => {
      let command = ffmpeg()
        .input(path.join(tempDir, 'img%03d.jpg'))
        .inputOptions([`-framerate 1/${secondsPerImage}`]);

      if (audioPath) {
        command = command.input(audioPath);
      }

      command
          .videoFilters(`scale=720:1280,zoompan=z='if(lte(zoom,1.0),1.0,zoom-0.002)':x='iw/2-(iw/zoom/2)':y='(ih/zoom/2)*sin(2*PI*on/60)':d=1*${secondsPerImage}*15, fps=15`)
          .outputOptions([
            '-preset ultrafast',
            '-r 15',
            '-b:v 500k',
            '-c:v libx264',
            '-pix_fmt yuv420p',
            ...(audioPath ? ['-shortest'] : [])
          ])
        .output(outputVideoPath)
        .on('start', cmd => console.log('🛠️ FFmpeg command :', cmd))
        .on('stderr', line => console.log('📣 FFmpeg stderr:', line))
        .on('end', () => {
          console.log('✅ Vidéo générée avec succès.');
          resolve();
        })
        .on('error', err => {
          console.error('❌ Erreur FFmpeg :', err.message);
          reject(err);
        })
        .run();
    });

    // Nettoyage
    console.log('🧹 Nettoyage du dossier temporaire...');
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('✅ Dossier temporaire supprimé.');

    const videoUrl = `${req.protocol}://${req.get('host')}/videos/${outputFileName}`;
    console.log('🎉 Vidéo disponible à :', videoUrl);
    res.json({ videoUrl });

  } catch (error) {
    console.error('🔥 Erreur générale :', error.stack || error.message);
    res.status(500).json({ error: 'Erreur serveur' });

    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log('🧼 Nettoyage du dossier temporaire après échec.');
    } catch (cleanupErr) {
      console.warn('⚠️ Échec du nettoyage du dossier temporaire :', cleanupErr.message);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
