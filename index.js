const express = require('express');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

const getAudioDuration = (audioPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
};

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

    console.log('🎞️ Génération des vidéos avec effet Ken Burns...');
    const kenBurnsVideos = [];

    for (let i = 0; i < imagePaths.length; i++) {
      const inputImage = imagePaths[i];
      const outputSegment = path.join(tempDir, `segment${i}.mp4`);
      kenBurnsVideos.push(outputSegment);

      const ffmpegCmd = `ffmpeg -y -loop 1 -t ${secondsPerImage} -i "${inputImage}" -filter_complex "[0:v]scale=2160:3840,zoompan=z='if(lte(zoom,1.0),1.0,zoom+0.0005)':x='(iw-(iw/zoom))/2':y='(ih-(ih/zoom))/2':d=125,fps=25" -s 1080x1920 -c:v libx264 -pix_fmt yuv420p "${outputSegment}"`;
      
      await new Promise((resolve, reject) => {
        exec(ffmpegCmd, (error, stdout, stderr) => {
          if (error) {
            console.error(`❌ Erreur FFmpeg pour ${inputImage}:`, error.message);
            reject(error);
          } else {
            console.log(`✅ Segment généré : ${outputSegment}`);
            resolve();
          }
        });
      });
    }

    const concatListPath = path.join(tempDir, 'concat.txt');
    await fs.writeFile(concatListPath, kenBurnsVideos.map(p => `file '${p}'`).join('\\n'));

    const outputFileName = `video_${Date.now()}.mp4`;
    const outputVideoPath = path.join(videosDir, outputFileName);

    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" ${audioPath ? `-i "${audioPath}" -shortest` : ''} -c:v libx264 -pix_fmt yuv420p -preset ultrafast -r 25 "${outputVideoPath}"`;

    await new Promise((resolve, reject) => {
      exec(concatCmd, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Erreur concaténation FFmpeg :', error.message);
          reject(error);
        } else {
          console.log('✅ Vidéo finale générée');
          resolve();
        }
      });
    });

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
