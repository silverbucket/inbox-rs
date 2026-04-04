const mimeToExt = <String, String>{
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'm4a',
};

const _extToMime = <String, String>{
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'heic': 'image/heic',
  'webp': 'image/webp',
  'mp4': 'video/mp4',
  'mov': 'video/quicktime',
  'avi': 'video/x-msvideo',
  'mkv': 'video/x-matroska',
  'm4v': 'video/x-m4v',
  'm4a': 'audio/mp4',
  'wav': 'audio/wav',
  'aac': 'audio/aac',
};

String extFromMime(String mime) => mimeToExt[mime] ?? mime.split('/').last;

String guessMime(String path, {bool isVideo = false}) {
  final ext = path.split('.').last.toLowerCase();
  if (isVideo) {
    return _extToMime[ext] ?? 'video/mp4';
  }
  return _extToMime[ext] ?? 'image/jpeg';
}

bool isVideoPath(String path) {
  final ext = path.split('.').last.toLowerCase();
  return const ['mp4', 'mov', 'avi', 'mkv', 'm4v'].contains(ext);
}
