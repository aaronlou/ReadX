/**
 * 跨 world 通信用的自定义事件名。
 *
 * 内容脚本（isolated world）和 MAIN world 脚本是两个独立的 JS realm，
 * 不能共享模块状态，但共享同一个 DOM —— 所以用 DOM 事件做桥。
 * 事件名放在这里，避免两边写错字符串。
 */
export const MAIN_WORLD_REQUEST = 'readx:probe-main-request';
export const MAIN_WORLD_RESPONSE = 'readx:probe-main-response';
