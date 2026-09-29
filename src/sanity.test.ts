describe('sanity', () => {
  it('runs TypeScript tests under Jest', () => {
    const bytes: Uint8Array = new Uint8Array(2);
    expect(bytes.length).toBe(2);
  });
});
