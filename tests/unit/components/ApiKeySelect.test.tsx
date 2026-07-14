import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApiKeySelect from '../../../src/components/ApiKeySelect';
import type { ApiKeyDTO } from '../../../src/lib/keys/schema';

const KEY_1: ApiKeyDTO = {
  id: '00000000-0000-4000-8000-000000000001',
  label: 'glm-ocr',
  provider: 'openai_compatible',
  model: 'glm-ocr',
  base_url: 'https://relay.example.com',
  is_active: true,
  last_tested_at: null,
  last_test_result: 'ok',
  created_at: '2026-01-01T00:00:00Z',
  request_timeout_ms: null,
  max_tokens_override: 8192,
};

const KEY_2: ApiKeyDTO = {
  ...KEY_1,
  id: '00000000-0000-4000-8000-000000000002',
  label: 'qwen3.5-9b',
  is_active: false,
};

describe('ApiKeySelect', () => {
  it('nie renderuje nic gdy keys === null (jeszcze nie załadowane)', () => {
    const { container } = render(<ApiKeySelect keys={null} value={null} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nie renderuje nic gdy dostępny 0 kluczy', () => {
    const { container } = render(<ApiKeySelect keys={[]} value={null} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nie renderuje nic gdy dostępny dokładnie 1 klucz', () => {
    const { container } = render(
      <ApiKeySelect keys={[KEY_1]} value={KEY_1.id} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renderuje dropdown z opcjami "etykieta (provider)" gdy 2+ kluczy', () => {
    render(<ApiKeySelect keys={[KEY_1, KEY_2]} value={KEY_1.id} onChange={vi.fn()} />);
    const select = screen.getByTestId('api-key-select');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('glm-ocr (openai_compatible)')).toBeInTheDocument();
    expect(screen.getByText('qwen3.5-9b (openai_compatible)')).toBeInTheDocument();
  });

  it('domyślnie zaznaczony jest przekazany value', () => {
    render(<ApiKeySelect keys={[KEY_1, KEY_2]} value={KEY_2.id} onChange={vi.fn()} />);
    const select = screen.getByTestId('api-key-select') as unknown as HTMLSelectElement;
    expect(select.value).toBe(KEY_2.id);
  });

  it('onChange wywołuje callback z id wybranego klucza', () => {
    const onChange = vi.fn();
    render(<ApiKeySelect keys={[KEY_1, KEY_2]} value={KEY_1.id} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('api-key-select'), { target: { value: KEY_2.id } });
    expect(onChange).toHaveBeenCalledWith(KEY_2.id);
  });
});
