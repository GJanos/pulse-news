export function resolveReaderBack(canGoBack: boolean): 'goBack' | 'close' {
  return canGoBack ? 'goBack' : 'close';
}
