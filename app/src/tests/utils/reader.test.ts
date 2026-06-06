import { resolveReaderBack } from '../../utils/reader';

describe('resolveReaderBack', () => {
  it('returns goBack when canGoBack is true', () => {
    expect(resolveReaderBack(true)).toBe('goBack');
  });

  it('returns close when canGoBack is false', () => {
    expect(resolveReaderBack(false)).toBe('close');
  });
});
