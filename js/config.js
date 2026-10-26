/* Supabase 연결 설정
 * publishable(anon) 키는 브라우저에 공개되는 값이다. 데이터 보호는 DB의 RLS가 맡는다.
 * service_role / secret 키는 절대 여기에 넣지 않는다.
 * 두 값을 비우면 브라우저 저장 방식(시제품 모드)으로 동작한다.
 */
window.PPP_CONFIG = {
  supabaseUrl: 'https://kpwggxtrvzgqiaekatxc.supabase.co',
  supabaseKey: 'sb_publishable_5_uCeOz_F1vBG7kNCpE0Lw_f79cES-n'
};
