/** Wspólny zestaw inputów metadanych książki — reużywany w BookModal (add/edit/propose). */

export type BookFieldValues = {
  title: string;
  authors: string;    // przecinkami
  publisher: string;
  year: string;
  isbn13: string;
  isbn10: string;
};

const inputCls =
  'mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export default function BookFields({
  values,
  onChange,
  readOnly = false,
}: {
  values: BookFieldValues;
  onChange?: (field: keyof BookFieldValues, value: string) => void;
  readOnly?: boolean;
}) {
  function handle(field: keyof BookFieldValues) {
    return (e: React.ChangeEvent<HTMLInputElement>) => onChange?.(field, e.target.value);
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Tytuł {!readOnly && <span className="text-red-500">*</span>}
        <input
          data-testid="book-field-title"
          value={values.title}
          onChange={handle('title')}
          readOnly={readOnly}
          required={!readOnly}
          className={inputCls}
        />
      </label>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Autor(zy) <span className="text-gray-400">(przecinki)</span>
        <input
          data-testid="book-field-authors"
          value={values.authors}
          onChange={handle('authors')}
          readOnly={readOnly}
          className={inputCls}
        />
      </label>
      <div className="flex gap-2">
        <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          Wydawca
          <input
            data-testid="book-field-publisher"
            value={values.publisher}
            onChange={handle('publisher')}
            readOnly={readOnly}
            className={inputCls}
          />
        </label>
        <label className="w-20 text-xs font-medium text-gray-700 dark:text-gray-300">
          Rok
          <input
            data-testid="book-field-year"
            type={readOnly ? 'text' : 'number'}
            min="1000"
            max="2100"
            value={values.year}
            onChange={handle('year')}
            readOnly={readOnly}
            className={inputCls}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          ISBN-13
          <input
            data-testid="book-field-isbn13"
            value={values.isbn13}
            onChange={handle('isbn13')}
            placeholder="9788300000000"
            readOnly={readOnly}
            className={inputCls}
          />
        </label>
        <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          ISBN-10
          <input
            data-testid="book-field-isbn10"
            value={values.isbn10}
            onChange={handle('isbn10')}
            readOnly={readOnly}
            className={inputCls}
          />
        </label>
      </div>
    </div>
  );
}
