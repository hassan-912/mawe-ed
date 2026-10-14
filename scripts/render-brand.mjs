import sharp from 'sharp';
for(const size of [192,512])await sharp('dist/assets/mawid-mark.svg').resize(size,size).png().toFile(`dist/assets/icon-${size}.png`);
await sharp('dist/assets/mawid-logo.svg').png().toFile('../mawid-logo.png');
