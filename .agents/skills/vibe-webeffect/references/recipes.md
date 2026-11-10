# recipes.md — 카테고리별 공용 구현 패턴

catalog.json의 `code`는 핵심 1~2줄이다. 실제 적용 시 이 파일의 보일러플레이트와 조합한다.
**공통 원칙: 라이브러리 0, transform/opacity 우선, reduced-motion 가드 필수.**

```js
// 모든 페이지 공통 — 최상단에 1회
const REDUCE = matchMedia("(prefers-reduced-motion:reduce)").matches;
```

---

## 1. reveal — IntersectionObserver 표준 보일러플레이트

옵저버는 **페이지에 1개만** 만들고 `[data-reveal]` 요소를 전부 등록한다.

```html
<section data-reveal>…</section>
<ul data-reveal data-stagger>…</ul>
```
```css
[data-reveal]{opacity:0;transform:translateY(34px);
  transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
[data-reveal].show{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){[data-reveal]{opacity:1;transform:none;transition:none}}
```
```js
const io = new IntersectionObserver(es=>es.forEach(e=>{
  if(!e.isIntersecting) return;
  e.target.classList.add("show");
  io.unobserve(e.target);            // 1회성. 스크롤마다 재생하려면 이 줄 삭제
}),{threshold:0.2});
document.querySelectorAll("[data-reveal]").forEach(el=>{
  if(el.hasAttribute("data-stagger")) // 자식 스태거
    [...el.children].forEach((c,i)=>c.style.transitionDelay=i*80+"ms");
  io.observe(el);
});
```
효과 교체는 CSS의 숨김 상태만 바꾸면 된다(clip-wipe, line-mask, alternate-slide 등 catalog 참조).

## 2. transition 재생 함정 — 스냅 리셋 패턴

transition 기반 효과를 **재트리거**할 때, 클래스를 뗐다 같은 틱에 붙이면 "변화 없음"으로 처리돼 재생되지 않는다. 반드시:

```css
.noanim,.noanim *{transition:none!important}
```
```js
function replay(el){
  el.classList.add("noanim");  // 1) transition 끄고
  el.classList.remove("show"); // 2) 숨김 상태로 즉시 스냅
  void el.offsetWidth;
  el.classList.remove("noanim");
  void el.offsetWidth;
  el.classList.add("show");    // 3) 재생
}
```
keyframes 애니메이션은 이 패턴 불필요 (`remove → reflow → add`로 재시작됨).

## 3. scroll — 스크럽 헬퍼 (관성 포함)

구조: `overflow-y:auto` 컨테이너 안에 `position:sticky` 무대 + 긴 트랙.

```html
<div class="scroller"><div class="stage"><!-- 여기 그린다 --></div><div class="track"></div></div>
```
```css
.scroller{height:420px;overflow-y:auto;overscroll-behavior:contain}
.stage{position:sticky;top:0;height:420px}
.track{height:1300px} /* 길수록 스크럽이 느긋해짐 */
```
```js
function scrub(scroller, onValue){
  let target=0, cur=0;
  scroller.addEventListener("scroll",()=>{
    const m=scroller.scrollHeight-scroller.clientHeight;
    target=m>0?scroller.scrollTop/m:0;
  },{passive:true});
  (function loop(){
    cur+=(target-cur)*0.13;              // lerp 관성
    onValue(REDUCE?target:cur);          // p: 0~1
    requestAnimationFrame(loop);
  })();
}
scrub(document.querySelector(".scroller"), p=>{ /* catalog의 code 적용 */ });
```
페이지 전체 스크롤 기준이면 scroller 대신 `document.documentElement` 사용:
`p = scrollY / (doc.scrollHeight - innerHeight)`.

## 4. hover — 커서 좌표 패턴

```js
// CSS 변수 주입형 (spotlight, tilt 등)
card.addEventListener("mousemove",e=>{
  const r=card.getBoundingClientRect();
  card.style.setProperty("--mx",(e.clientX-r.left)+"px");
  card.style.setProperty("--my",(e.clientY-r.top)+"px");
});
// lerp 추적형 (magnetic, custom-cursor): scrub과 동일한 rAF+lerp 사용
```
데모/쇼케이스 목적이면 자동 궤도(`mx=w*(.5+.34*cos(T))`)를 넣고 mousemove가 override.

## 5. micro — 스프링 상수

```css
/* 유일한 공용 이징 — 목표를 살짝 지나쳤다 돌아온다 */
transition: transform .5s cubic-bezier(.34,1.56,.64,1);
```
- 상태는 클래스 토글(`on`/`load`/`done`)로만 관리
- 파티클류(like-burst)는 요소당 CSS 변수(--dx,--dy)로 방향만 다르게, keyframes는 1개

## 6. loading — 선택 규칙 (UX)

| 상황 | 쓸 것 |
|---|---|
| 진행률 앎 (업로드 등) | progress-determinate + % 숫자 필수 |
| 진행률 모름, 짧음 | conic-spinner / dot-bounce |
| 진행률 모름, 페이지 단위 | progress-indeterminate (상단 바) |
| 콘텐츠 구조 앎 (피드/카드) | skeleton-shimmer (체감 대기 최단) |
| 챗/AI 응답 대기 | typing-indicator |
| 완료/실패 | success-check / error-shake (+메시지) |
| 1초 미만 | 아무것도 띄우지 않는다 |

## 7. canvas 공통 — DPR 맞춤

```js
function fit(cv){
  const dpr=Math.min(2,devicePixelRatio||1), r=cv.getBoundingClientRect();
  cv.width=r.width*dpr; cv.height=r.height*dpr;
  const ctx=cv.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx, w:r.width, h:r.height};
}
// 루프는 항상: if(!REDUCE) requestAnimationFrame(loop)
```

## 8. SVG goo 필터 (gooey-metaballs)

```html
<filter id="goo">
  <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b"/>
  <feColorMatrix in="b" mode="matrix"
    values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"/>
</filter>
<g filter="url(#goo)"><!-- 원들 --></g>
```
`22 -10`이 융합 강도. 블러 stdDeviation과 함께 조절.

## 9. 강도 배합 체크리스트 (적용 후 자가검증)

- [ ] 한 뷰포트에 bold 효과 1개 이하인가
- [ ] reduced-motion 가드가 모든 애니메이션에 있는가
- [ ] filter/box-shadow를 큰 영역에 애니메이션하지 않았는가
- [ ] 스크롤 리스너에 {passive:true}, 무거운 계산은 rAF 안인가
- [ ] 적용한 효과 이름(KR+EN)을 사용자에게 보고했는가
