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
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
};

app.use('/videos', express.static(path.join(__dirname, 'public/videos')));

app.post('/create-video', async (req, res) => {
  console.log('📥 Reçue /create-video');
  const { images, audioUrl } = req.body;

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Aucune image fournie.' });
  }

  const videosDir = path.join(__dirname, 'public/videos');
  const tempDir = path.join(__dirname, 'temp', Date.now().toString());

  try {
    await fs.mkdir(videosDir, { recursive: true });
    const existingFiles = await fs.readdir(videosDir);
    await Promise.all(existingFiles.filter(f => f.endsWith('.mp4')).map(f => fs.unlink(path.join(videosDir, f))));

    await fs.mkdir(tempDir, { recursive: true });

    const imagePaths = [];
    for (let i = 0; i < images.length; i++) {
      const url = images[i];
      const fileName = `img${String(i + 1).padStart(3, '0')}.jpg`;
      const filePath = path.join(tempDir, fileName);

      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      await fs.writeFile(filePath, response.data);
      imagePaths.push(filePath);
    }

    let audioPath = null;
    let secondsPerImage = 6;

    if (audioUrl) {
      const audioData = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 15000 });
      audioPath = path.join(tempDir, 'audio.mp3');
      await fs.writeFile(audioPath, audioData.data);

      const audioDuration = await getAudioDuration(audioPath);
      secondsPerImage = Math.max(1, Math.min(audioDuration / images.length, 20));
    }

    const videoClips = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      const outputClip = path.join(tempDir, `clip${i}.mp4`);
      await new Promise((resolve, reject) => {
        ffmpeg(imagePath)
          .loop(secondsPerImage)
          .videoFilters([
            `zoompan=z='zoom+0.0015':d=${Math.floor(secondsPerImage * 25)}:s=720x1280`,
            'format=yuv420p'
          ])
          .outputOptions([`-t ${secondsPerImage}`, '-r 25', '-preset ultrafast'])
          .output(outputClip)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      videoClips.push(outputClip);
    }

    const concatList = path.join(tempDir, 'files.txt');
    await fs.writeFile(concatList, videoClips.map(p => `file '${p}'`).join('\n'));

    const outputFileName = `video_${Date.now()}.mp4`;
    const outputVideoPath = path.join(videosDir, outputFileName);

    let command = ffmpeg().input(concatList).inputOptions(['-f concat', '-safe 0']);

    if (audioPath) {
      command = command.input(audioPath);
    }

    await new Promise((resolve, reject) => {
      command
        .videoCodec('libx264')
        .outputOptions(['-preset ultrafast', '-pix_fmt yuv420p', '-r 25', ...(audioPath ? ['-shortest'] : [])])
        .output(outputVideoPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    await fs.rm(tempDir, { recursive: true, force: true });

    const videoUrl = `${req.protocol}://${req.get('host')}/videos/${outputFileName}`;
    res.json({ videoUrl });

  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
