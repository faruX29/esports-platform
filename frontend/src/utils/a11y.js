// Tıklanabilir <div onClick> öğelerini klavyeyle erişilebilir yapar.
// role="button" + tabIndex=0 + Enter/Space ile aktivasyon verir.
// Kullanım: <div {...clickableProps(() => navigate(...))} onClick=... > — ya da
// onClick'i ayrıca vermeye gerek kalmadan onActivate hepsini kapsar:
//   <div {...clickableProps(() => navigate(path))}>
export function clickableProps(onActivate, { label } = {}) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        onActivate(e)
      }
    },
    ...(label ? { 'aria-label': label } : {}),
  }
}
