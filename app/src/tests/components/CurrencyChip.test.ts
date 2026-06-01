import { changeDisplay } from '../../components/CurrencyChip';

const FAINT = '#999999';
const POSITIVE = '#27ae60';
const NEGATIVE = '#c0392b';

describe('changeDisplay', () => {
  it('renders nothing when change is null (yesterday unavailable)', () => {
    expect(changeDisplay(null, FAINT)).toEqual({ arrow: '', label: '', color: FAINT });
  });

  it('shows a green up-arrow for a meaningful gain', () => {
    expect(changeDisplay(0.18, FAINT)).toEqual({ arrow: '↑', label: '0.18%', color: POSITIVE });
  });

  it('shows a red down-arrow with the absolute value for a loss', () => {
    expect(changeDisplay(-1.19, FAINT)).toEqual({ arrow: '↓', label: '1.19%', color: NEGATIVE });
  });

  it('shows a faint dash (no number) for moves that round to 0.00%', () => {
    expect(changeDisplay(0.002, FAINT)).toEqual({ arrow: '—', label: '', color: FAINT });
    expect(changeDisplay(-0.004, FAINT)).toEqual({ arrow: '—', label: '', color: FAINT });
    expect(changeDisplay(0, FAINT)).toEqual({ arrow: '—', label: '', color: FAINT });
  });

  it('treats ±0.005 as the smallest displayable move', () => {
    expect(changeDisplay(0.005, FAINT)).toEqual({ arrow: '↑', label: '0.01%', color: POSITIVE });
    expect(changeDisplay(-0.005, FAINT)).toEqual({ arrow: '↓', label: '0.01%', color: NEGATIVE });
  });
});
