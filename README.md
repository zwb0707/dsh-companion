# 澧ㄦ睈浜烘牸杩愯鏃讹紙dsh-moxi锛?
鎶娿€屽ス銆嶈窇璧锋潵鐨勬湰鍦板簳搴э細璁板繂銆佸績鎯呫€佹姢鏍忋€佷富鍔ㄥ紑鍙ｏ紝浠ュ強 51 涓?`moxi_*` 宸ュ叿銆?QQ 缃戝叧銆佹姈闊炽€佽仈缃戦兘鏄?*鍙€夋帴绾?*鈥斺€旀病鎺ョ殑鏃跺€欏姩浣滀細鏄庣‘鎶?`not-connected`锛屼笉浼氶潤榛樺け璐ャ€?
## 瑁?
```bash
# 鏈湴鐩綍瀹夎锛圖SH銆屾彃浠躲€嶉〉闈?鈫?娣诲姞鎻掍欢 鈫?閫夎繖涓洰褰曪級
# 鎴?dsh plugin add <path-to-this-package>
```

瀹夎鍚庡湪 profile 鐨?`cordis.patch.yml` 閲岃兘鐪嬪埌 `moxi` 杩欎竴琛岋紱閰嶇疆鏀硅繖涓€琛岀殑 `config`銆?
## 閰嶇疆

```yaml
- insert:
    - id: moxi
      name: 'dsh-moxi'
      config:
        home: ''                     # 鐣欑┖锛欴SH profile 鐩綍/moxi锛屽啀閫€鍒?~/.dsh-moxi
        gateway:
          enabled: false             # 鎺ヤ簡 OneBot 鎵嶅紑
          baseUrl: 'http://127.0.0.1:3004'
          wsUrl: 'ws://127.0.0.1:3005'
        tools:
          prefix: moxi
```

鏁版嵁钀藉湪 `home` 涓嬶細`data/memory.sqlite`锛堣蹇?娴佹按/绾﹀畾/榛戣瘽锛夈€乣data/persona/role-card.md`锛堜汉鏍煎崱锛屽彧璇伙級銆?`state/*.json`锛堟殏鍋?妯″紡/鎶ゆ爮锛夈€乣data/logs/`銆?
## 鑳藉姏鐜扮姸

| 绫诲埆 | 鍔ㄤ綔鏁?| 鐘舵€?|
|---|---|---|
| 鏈湴锛堣蹇?鐘舵€?鎶ゆ爮/琛ㄦ儏/鏃ュ織/棰濆害锛?| 24 | 鉁?宸插疄鐜板苟鏈夋祴璇?|
| QQ 缃戝叧锛堟敹鍙?鏈/寮曠敤/鎷嶄竴鎷嶁€︼級 | 18 | 鈴?閫傞厤鍣ㄤ腑锛堟湭鎺ユ椂杩斿洖 `not-connected`锛?|
| 澶ц剳鍥炲悎锛堟紨缁?鏃ユ姤/鐩殑绱犳潗/鍞ら啋/鏀跺熬锛?| 5 | 鉁?宸插疄鐜帮紙婕旂粌璧?ctx.llm.stream锛?|
| 鎶栭煶锛堝叆鍙ｈ浆鍙戯級 | 2 | 鈴?闇€瑕侀厤濂楁姈闊?bundle |
| 鑱旂綉锛堟悳绱?鎶撳彇锛?| 2 | 鉁?璧?DSH `ctx.web` |

## 涓诲姩寮€鍙?
閰嶇疆 purpose.enabled: true 涓旂綉鍏?+ llm 閮藉湪鏃讹紝鎻掍欢鎸?purpose.tickMs锛堥粯璁?5 鍒嗛挓锛夋鏌ヤ竴娆★細
鏆傚仠涓€侀潤榛樻椂娈点€佸綋鏃ヤ笂闄愩€侀棿闅斾笉瓒炽€佸敜閱掗搴︾敤瀹?鈥斺€?浠讳竴鍛戒腑灏变笉寮€鍙ｃ€傚紑鍙ｅ墠杩囦竴娆″嚭绔欏畨妫€锛?璇村畬璁版祦姘翠笌璁板繂銆俶oxi_status 閲岃兘鐪嬪埌 purpose.verdict锛堝綋鍓嶄负浠€涔堜笉璇磋瘽锛夈€?
## 浠庢棫杩愯鏃惰縼绉?
鏃ц繍琛屾椂锛堢嫭绔嬪畧鎶よ繘绋嬮偅濂楋級鐨勫簱琛ㄧ粨鏋勪笌鏈彃浠朵竴鑷达紝鍙互鐩存帴鎼細

```bash
node scripts/import-from-runtime.mjs --from <鏃ц繍琛屾椂鏍圭洰褰? --to <鏈彃浠?home> [--dry]
```

鎼?`memory.sqlite` 鐨勫叚寮犺〃锛堝垪鍚嶅彇浜ら泦锛岄噸澶嶈璺宠繃锛夈€乣persona/*.md`銆乣mode/send-guard/wake-budget/stickers/access.json`锛?鏃ュ織銆佷細璇濆綊妗ｃ€佸浘鐗囥€佹姈闊崇姸鎬佷笉鎼€俙--dry` 鍙墦鍗拌鍒掋€?
## 閰嶇疆鍙傝€?
瀹屾暣瀛楁瑙?`moxi.config.example.json`銆傚父鐢ㄧ殑鍑犻」锛?
| 瀛楁 | 浣滅敤 |
|---|---|
| `home` | 鏁版嵁鐩綍锛涚暀绌烘寜 DSH profile 鈫?`~/.dsh-moxi` 鍏滃簳 |
| `gateway.enabled / baseUrl / wsUrl / token` | OneBot 11 缃戝叧锛涗笉寮€灏卞叏閮ㄧ綉鍏冲姩浣滆繑鍥?`not-connected` |
| `access.allow.private / groups` | 璁稿彲鍚嶅崟锛屽悕鍗曞涓€寰嬫嫆鍙?|
| `send.maxSendPerMinute / maxSendPerHour` | 鍙戦€侀檺閫?|
| `history.enabled` | 鏄惁鍏佽 `moxi_catchup` 鎷夊巻鍙诧紙榛樿 false锛岄伩鍏嶆竻搴撳悗鍙堟妸鍘嗗彶鐏屽洖鏉ワ級 |
| `mood.rates / thresholds` | 蹇冩儏婕傜Щ閫熷害涓庢弿杩伴槇鍊?|
| `purpose.*` | 涓诲姩寮€鍙ｏ細鎬诲紑鍏炽€佺洰鏍囦細璇濄€佹瘡鏃ヤ笂闄愩€侀棿闅斻€侀潤榛樻椂娈点€佹鏌ラ鐜?|
| `agent.provider / model` | 婕旂粌鐢ㄧ殑妯″瀷锛涚暀绌鸿窡闅?DSH 榛樿妯″瀷 |

## 寮€鍙?
```bash
node --test "test/*.test.mjs"        # 5 涓敤渚嬶細娉ㄥ唽濂戠害銆佸伐鍏?schema銆佹湰鍦板姩浣溿€佹湭鎺ョ嚎琛屼负銆佸嵏杞?node --check index.mjs
```

`test/smoke.test.mjs` 鐢ㄤ竴涓亣 `ctx` 璺戯紝涓嶉渶瑕佽杩?DSH銆?
## 璁捐绾︽潫

- **浜烘牸鍙**锛氬崱鏄敤鎴疯祫浜э紝鎻掍欢鍙涓嶅啓銆?- **璁板繂鏄淳鐢熺紦瀛?*锛氫細璇濇棩蹇楁墠鏄湡鐩革紱璁板繂鍧忎簡鍙互浠庢棩蹇楅噸寤恒€?- **涓嶅鍙?*锛氶櫎 `outbound` 鏍囪鐨勫姩浣滃锛屾彃浠朵笉涓诲姩鍙戞秷鎭€?- **璺緞鍙Щ妞?*锛氭病鏈夊啓姝荤洏绗︼紱`home` 鍐冲畾涓€鍒囨暟鎹綅缃€?