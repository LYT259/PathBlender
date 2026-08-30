import { useI18n } from '../i18n';

interface Props {
  errors: { fileName: string; message: string }[];
  onDismiss: () => void;
}

export function ImportBanner({ errors, onDismiss }: Props) {
  const { t } = useI18n();
  if (errors.length === 0) return null;
  return (
    <div className="import-banner">
      <div className="import-banner-body">
        <b>{t('import.failed', { n: errors.length })}</b>
        <ul>
          {errors.map((e, i) => (
            <li key={i}>
              <code>{e.fileName}</code> — {e.message}
            </li>
          ))}
        </ul>
      </div>
      <button className="btn small" onClick={onDismiss}>
        {t('import.dismiss')}
      </button>
    </div>
  );
}
