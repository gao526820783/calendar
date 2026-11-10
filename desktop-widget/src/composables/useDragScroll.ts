import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/**
 * 鼠标拖动横向滚动（不显示滚动条）。
 *
 * 桌面小工具的横向列表用原生 overflow 滚动条体验很差：细、难点、且在窄窗口里
 * 常被裁掉。这里用指针事件接管「按住拖动」，把位移映射到 scrollLeft，
 * 滚动条通过 CSS 隐藏（scrollbar-width: none）。
 *
 * - 使用 pointer 事件，鼠标/触控笔/触摸板拖动均可用
 * - 拖动距离超过阈值后抑制 click，避免误触发卡片上的按钮
 * - 松手后带惯性滑动（惯性动画由 CSS scroll-snap 关闭时手动实现）
 */
export interface DragScrollOptions {
  /** 触发拖动的最小位移（px），小于该值视为点击 */
  threshold?: number;
  /** 惯性衰减系数（越小滑得越远） */
  friction?: number;
}

export function useDragScroll(
  target: Ref<HTMLElement | null>,
  options: DragScrollOptions = {},
) {
  const { threshold = 4, friction = 0.94 } = options;

  /** 是否正在拖动（用于切换 grabbing 光标） */
  const dragging = ref(false);
  /** 本次拖动是否已超过阈值（用于抑制 click） */
  const moved = ref(false);

  let startX = 0;
  let startScrollLeft = 0;
  let pointerId = -1;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let rafId = 0;

  function onPointerDown(e: PointerEvent) {
    const el = target.value;
    if (!el) return;
    // 只处理主键 / 触摸 / 触控笔
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 已经是纵向滚动的区域（内容溢出）不接管
    if (el.scrollWidth <= el.clientWidth) return;

    pointerId = e.pointerId;
    startX = e.clientX;
    lastX = e.clientX;
    lastT = performance.now();
    startScrollLeft = el.scrollLeft;
    velocity = 0;
    moved.value = false;
    dragging.value = true;
    cancelInertia();

    el.setPointerCapture?.(e.pointerId);
    // 阻止拖动时选中文本
    document.body.style.userSelect = 'none';
  }

  function onPointerMove(e: PointerEvent) {
    const el = target.value;
    if (!el || !dragging.value || e.pointerId !== pointerId) return;

    const dx = e.clientX - startX;
    if (!moved.value && Math.abs(dx) < threshold) return;
    if (!moved.value) {
      moved.value = true;
      // 首次超过阈值后接管拖动，避免与点击冲突
      el.setPointerCapture?.(e.pointerId);
    }

    el.scrollLeft = startScrollLeft - dx;

    // 计算瞬时速度（px/ms），用于松手后的惯性
    const now = performance.now();
    const dt = now - lastT;
    if (dt > 0) {
      velocity = (e.clientX - lastX) / dt;
      lastX = e.clientX;
      lastT = now;
    }
    e.preventDefault();
  }

  function endDrag(e: PointerEvent) {
    if (!dragging.value || e.pointerId !== pointerId) return;

    dragging.value = false;
    pointerId = -1;
    document.body.style.userSelect = '';

    // 只有明显是「甩」一下才给惯性，普通慢速拖动直接停
    if (Math.abs(velocity) > 0.35) startInertia();

    // 兜底：拖动后若没有 click 到来，稍后复位 moved，避免吞掉下一次正常点击
    window.setTimeout(() => {
      moved.value = false;
    }, 350);
  }

  function startInertia() {
    cancelInertia();
    const step = () => {
      const node = target.value;
      if (!node || Math.abs(velocity) < 0.02) {
        velocity = 0;
        return;
      }
      node.scrollLeft -= velocity * 16;
      velocity *= friction;
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  function cancelInertia() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  /** 拖动结束后拦截随之而来的 click，避免误触发 */
  function onClickCapture(e: MouseEvent) {
    if (!moved.value) return;
    e.preventDefault();
    e.stopPropagation();
    moved.value = false;
  }

  /** Shift + 滚轮 → 横向滚动（不劫持普通滚轮的纵向滚动） */
  function onWheel(e: WheelEvent) {
    const el = target.value;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (!e.shiftKey) return;
    el.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
    e.preventDefault();
  }

  onMounted(() => {
    const el = target.value;
    if (!el) return;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('wheel', onWheel, { passive: false });
  });

  onBeforeUnmount(() => {
    const el = target.value;
    if (el) {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('wheel', onWheel);
    }
    cancelInertia();
    document.body.style.userSelect = '';
  });

  return { dragging, moved };
}
