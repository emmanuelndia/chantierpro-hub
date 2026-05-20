document.querySelectorAll('.screenshot-slot').forEach((slot) => {
  const image = slot.querySelector('img');
  const placeholder = slot.querySelector('.shot-placeholder');
  const code = slot.querySelector('.shot-placeholder code');

  if (!image || !placeholder) {
    return;
  }

  const originalSrc = image.getAttribute('src') || '';
  const extensionMatch = originalSrc.match(/\.(png|jpe?g)$/i);
  const baseSrc = extensionMatch ? originalSrc.slice(0, -extensionMatch[0].length) : originalSrc;
  const preferredExtensions = extensionMatch
    ? [extensionMatch[0], '.jpeg', '.jpg', '.png']
    : ['.jpeg', '.jpg', '.png'];
  const candidates = Array.from(new Set(preferredExtensions.map((ext) => `${baseSrc}${ext}`)));
  let candidateIndex = candidates.indexOf(originalSrc);

  if (candidateIndex < 0) {
    candidateIndex = 0;
  }

  const showImage = () => {
    slot.classList.add('has-image');
    image.hidden = false;
    image.style.display = 'block';
    placeholder.hidden = true;
    placeholder.style.display = 'none';
  };

  const showPlaceholder = () => {
    slot.classList.remove('has-image');
    image.hidden = true;
    image.style.display = 'none';
    placeholder.hidden = false;
    placeholder.style.display = '';
  };

  const tryNextCandidate = () => {
    candidateIndex += 1;

    if (candidateIndex < candidates.length) {
      image.hidden = false;
      image.style.display = 'block';
      image.src = candidates[candidateIndex];

      if (code) {
        code.textContent = candidates[candidateIndex];
      }
      return;
    }

    showPlaceholder();
  };

  if (image.complete) {
    if (image.naturalWidth > 0) {
      showImage();
    } else if (originalSrc) {
      tryNextCandidate();
    }
  }

  image.addEventListener('load', () => {
    showImage();
  });

  image.addEventListener('error', () => {
    tryNextCandidate();
  });
});
