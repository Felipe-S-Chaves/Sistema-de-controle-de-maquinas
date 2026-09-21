'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config/env');
const AppError = require('../utils/AppError');

/** Garante que o diretorio de uploads do mes exista. */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ensureDir(config.uploads.dir);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const now = new Date();
    const sub = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
    const dest = path.join(config.uploads.dir, sub);
    try {
      ensureDir(dest);
      req.uploadSubdir = sub;
      cb(null, dest);
    } catch (error) {
      cb(error);
    }
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = config.uploads.allowedExtensions.includes(ext) ? ext : '.jpg';
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`;
    cb(null, unique);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = config.uploads.allowedMimeTypes.includes(file.mimetype);
  const extOk = config.uploads.allowedExtensions.includes(ext);
  if (!mimeOk || !extOk) {
    return cb(AppError.validation(
      'Formato de imagem nao suportado. Envie JPG, PNG ou WEBP.',
      { images: 'Formato de imagem nao suportado.' }
    ));
  }
  return cb(null, true);
}

const uploader = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.uploads.maxFileSizeBytes,
    files: config.uploads.maxFiles
  }
});

/** Aceita ate N imagens no campo "images". */
const uploadCollectionImages = uploader.array('images', config.uploads.maxFiles);

/** Uma foto so, no campo "document_photo" - o documento do cliente. */
const uploadOwnerDocument = uploader.single('document_photo');

/** Remove arquivos ja gravados quando a transacao falha. */
function cleanupFiles(files = []) {
  for (const file of files) {
    if (!file || !file.path) continue;
    fs.promises.unlink(file.path).catch(() => { /* arquivo ja removido */ });
  }
}

/** Assinaturas binarias reais (defesa contra MIME falsificado). */
const MAGIC_NUMBERS = [
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] }
];

async function isRealImage(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(12);
    await handle.read(buffer, 0, 12, 0);
    if (MAGIC_NUMBERS.some((sig) => sig.bytes.every((b, i) => buffer[i] === b))) return true;
    // HEIC/HEIF: 'ftyp' no offset 4
    return buffer.slice(4, 8).toString('ascii') === 'ftyp';
  } finally {
    await handle.close();
  }
}

/** SHA-256 do arquivo, guardado como prova de integridade. */
function checksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = {
  uploadCollectionImages, uploadOwnerDocument, cleanupFiles, isRealImage, checksum, ensureDir
};
