process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const express = require('express');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(express.json());

const getAudioDuration = (audioPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) {
        console.error('Erreur ffprobe:', err);
        return reject(err);
      }
      resolve(metadata.format.duration);
    });
  });
};

app.use('/videos', express.static(path.join(__dirname, 'public/videos')));

app.post('/create-video', async (req, res) => {
  console.log('➡️ Nouvelle requête reçue pour /create-video');

  const { images, audioUrl } = req.body;
  if (!Array.isArray(images) || images.length === 0) {
    console.log('❌ Aucune image fournie dans la requête');
    return res.status(400).json({ error: 'Aucune image fournie.' });
  }

  const videosDir = path.join(__dirname, 'public/videos');
  const tempBaseDir = path.join(__dirname, 'temp');
  const tempDir = path.join(tempBaseDir, Date.now().toString());

  try {
    console.log('📁 Création et nettoyage du dossier videos');
    await fs.mkdir(videosDir, { recursive: true });
    const existingFiles = await fs.readdir(videosDir);
    await Promise.all(existingFiles
      .filter(f => f.endsWith('.mp4'))
      .map(f => fs.unlink(path.join(videosDir, f)))
    );
    console.log('✅ Dossier videos nettoyé');

    console.log('🧹 Nettoyage du dossier temp (si existant)');
    await fs.rm(tempBaseDir, { recursive: true, force: true });

    console.log('📂 Création du dossier temporaire:', tempDir);
    await fs.mkdir(tempDir, { recursive: true });

    console.log(`⬇️ Téléchargement de ${images.length} images`);
    const imagePaths = await Promise.all(images.map(async (url, index) => {
      const fileName = `img${String(index + 1).padStart(3, '0')}.jpg`;
      const filePath = path.join(tempDir, fileName);
      console.log(`➡️ Téléchargement de l'image ${index + 1}: ${url}`);
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      await fs.writeFile(filePath, response.data);
      console.log(`✅ Image sauvegardée: ${fileName}`);
      return filePath;
    }));

    let audioPath = null;
    let secondsPerImage = 8;

    if (audioUrl) {
      console.log('⬇️ Téléchargement de l’audio:', audioUrl);
      const audioData = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      audioPath = path.join(tempDir, 'audio.mp3');
      await fs.writeFile(audioPath, audioData.data);
      console.log('✅ Audio sauvegardé');

      console.log('⏱️ Extraction de la durée audio');
      const audioDuration = await getAudioDuration(audioPath);
      console.log(`⏲️ Durée audio détectée: ${audioDuration}s`);
      secondsPerImage = audioDuration / images.length;
      secondsPerImage = Math.max(1, Math.min(secondsPerImage, 20));
      console.log(`⏳ Durée par image calculée: ${secondsPerImage}s`);
    }

    const outputFileName = `video_${Date.now()}.mp4`;
    const outputVideoPath = path.join(videosDir, outputFileName);

    console.log('🎬 Lancement de la création vidéo avec ffmpeg');
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
        .on('start', (cmdLine) => {
          console.log('▶️ ffmpeg start avec la commande :', cmdLine);
        })
        .on('progress', (progress) => {
          console.log(`⏳ Progression ffmpeg : frames=${progress.frames}, temps=${progress.timemark}`);
        })
        .on('end', () => {
          console.log('✅ Vidéo créée avec succès:', outputFileName);
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Erreur ffmpeg:', err);
          reject(err);
        })
        .run();
    });

    console.log('🧹 Nettoyage des fichiers temporaires');
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('✅ Nettoyage temporaire terminé');

    const videoUrl = `${req.protocol}://${req.get('host')}/videos/${outputFileName}`;
    console.log('📤 Envoi de la réponse avec URL vidéo');
    res.json({ videoUrl });

  } catch (error) {
    console.error('❌ Erreur lors de la génération de la vidéo :', error);
    res.status(500).json({ error: 'Erreur serveur' });

    try {
      console.log('🧹 Tentative de nettoyage du dossier temporaire après erreur');
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log('✅ Nettoyage temporaire après erreur terminé');
    } catch (cleanupErr) {
      console.warn('⚠️ Erreur de nettoyage du dossier temporaire :', cleanupErr.message);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
