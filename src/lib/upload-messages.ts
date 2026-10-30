/**
 * Upload limits and the messages shown when a file is refused (audit BUG-06). Used in the browser
 * (checked before sending) and for the server's answer, in the staff member's language.
 * The server limit is UPLOAD_MAX_BYTES (default 5 MB); Next.js refuses Server Action bodies above
 * 6 MB before our code runs, so the browser check is what protects against a crash screen.
 */
export const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
type Lang = 'pt' | 'en' | 'fr' | 'ar' | 'es';
export type UploadMessageCode = 'image_too_large' | 'file_too_large' | 'unsupported_type' | 'no_file' | 'request_failed';

const T: Record<Lang, Record<UploadMessageCode, (mb: string) => string>> = {
  pt: {
    image_too_large: (mb) => `Imagem demasiado grande. O tamanho máximo permitido é ${mb} MB.`,
    file_too_large: (mb) => `Ficheiro demasiado grande. O tamanho máximo permitido é ${mb} MB.`,
    unsupported_type: () => 'Só são aceites imagens PNG, JPEG ou WebP.',
    no_file: () => 'Escolha um ficheiro.',
    request_failed: () => 'Não foi possível enviar o formulário. Verifique a ligação e tente novamente.',
  },
  en: {
    image_too_large: (mb) => `Image too large. Maximum allowed size is ${mb} MB.`,
    file_too_large: (mb) => `File too large. Maximum allowed size is ${mb} MB.`,
    unsupported_type: () => 'Only PNG, JPEG or WebP images are accepted.',
    no_file: () => 'Please choose a file.',
    request_failed: () => 'The form could not be sent. Check the connection and try again.',
  },
  fr: {
    image_too_large: (mb) => `Image trop volumineuse. La taille maximale autorisée est de ${mb} Mo.`,
    file_too_large: (mb) => `Fichier trop volumineux. La taille maximale autorisée est de ${mb} Mo.`,
    unsupported_type: () => 'Seules les images PNG, JPEG ou WebP sont acceptées.',
    no_file: () => 'Choisissez un fichier.',
    request_failed: () => 'Le formulaire n’a pas pu être envoyé. Vérifiez la connexion et réessayez.',
  },
  es: {
    image_too_large: (mb) => `Imagen demasiado grande. El tamaño máximo permitido es de ${mb} MB.`,
    file_too_large: (mb) => `Archivo demasiado grande. El tamaño máximo permitido es de ${mb} MB.`,
    unsupported_type: () => 'Solo se aceptan imágenes PNG, JPEG o WebP.',
    no_file: () => 'Elija un archivo.',
    request_failed: () => 'No se pudo enviar el formulario. Compruebe la conexión e inténtelo de nuevo.',
  },
  ar: {
    image_too_large: (mb) => `الصورة كبيرة جدًا. الحد الأقصى المسموح به هو ${mb} ميغابايت.`,
    file_too_large: (mb) => `الملف كبير جدًا. الحد الأقصى المسموح به هو ${mb} ميغابايت.`,
    unsupported_type: () => 'تُقبل فقط صور PNG أو JPEG أو WebP.',
    no_file: () => 'اختر ملفًا.',
    request_failed: () => 'تعذّر إرسال النموذج. تحقّق من الاتصال وحاول مرة أخرى.',
  },
};

const toLang = (tag: string | null | undefined): Lang => {
  const l = (tag ?? '').slice(0, 2).toLowerCase();
  return l === 'en' || l === 'fr' || l === 'ar' || l === 'es' ? l : 'pt';
};
const mbOf = (bytes: number) => String(Math.round((bytes / (1024 * 1024)) * 10) / 10).replace(/\.0$/, '');

export function uploadMessage(code: UploadMessageCode, langTag: string | null | undefined, maxBytes = DEFAULT_UPLOAD_MAX_BYTES): string {
  return T[toLang(langTag)][code](mbOf(maxBytes));
}

/** Server → client error code carried in ActionResult.error, e.g. "upload:file_too_large:5242880". */
export const uploadErrorCode = (code: UploadMessageCode, maxBytes: number) => `upload:${code}:${maxBytes}`;
export function parseUploadErrorCode(error: string): { code: UploadMessageCode; maxBytes: number } | null {
  const m = /^upload:([a-z_]+):(\d+)$/.exec(error);
  return m && m[1] in T.en ? { code: m[1] as UploadMessageCode, maxBytes: Number(m[2]) } : null;
}
