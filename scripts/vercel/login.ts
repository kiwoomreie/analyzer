// Vercel 함수 진입점(빌드 시 .vercel/output/functions 로 번들). 실제 처리: server/hosted.ts
import { hostedHandlers } from "../../server/hosted.ts";
export default hostedHandlers().login;
