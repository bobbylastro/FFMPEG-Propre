app.post('/create-video', async (req, res) => {
  const { images, audio } = req.body; // Ajout du paramètre audio

  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Aucune image fournie' });
  }

  try {
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
      console.warn('Aucune vidéo à supprimer ou erreur:', err.message);
    }

    const tempDir = path.join(__dirname, 'temp', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    const imageDownloadPromises = images.map(async (url, i) => {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const fileName = `img${String(i + 1).padStart(3, '0')}.jpg`;
      const filePath = path.join(tempDir, fileName);
      await fs.writeFile(filePath, response.data);
      return filePath;
    });

    await Promise.all(imageDownloadPromises);

    let audioPath = null;
    if (audio) {
      const audioResponse = await axios.get(audio, { responseType: 'arraybuffer' });
      audioPath = path.join(tempDir, 'audio.mp3');
      await fs.writeFile(audioPath, audioResponse.data);
    }

    const outputFileName = `video_${Date.now()}.mp4`;
    const outputVideoPath = path.join(__dirname, 'public/videos', outputFileName);
    await fs.mkdir(path.dirname(outputVideoPath), { recursive: true });

    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(path.join(tempDir, 'img%03d.jpg'))
        .inputOptions(['-framerate 1/5'])
        .outputOptions(['-c:v libx264', '-r 30', '-pix_fmt yuv420p']);

      if (audioPath) {
        command.input(audioPath).audioCodec('aac');
      }

      command
        .output(outputVideoPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    await fs.rm(tempDir, { recursive: true, force: true });

    const videoUrl = `${req.protocol}://${req.get('host')}/videos/${outputFileName}`;
    res.json({ videoUrl });

  } catch (error) {
    console.error('Erreur serveur :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
