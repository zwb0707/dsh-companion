# 鍙戝竷鎵嬪唽锛堜竴娆℃€т笂浼狅級

浠撳簱灏辨槸 `D:\her\packages\dsh-moxi` 杩欎釜鐩綍鏈韩锛堟彃浠跺寘 = 浠撳簱鏍癸級銆?
## 0. 涓婁紶鍓嶅凡缁忓氨缁殑涓滆タ

- `git init -b main` 宸叉墽琛岋紝38 涓枃浠跺凡 `git add`锛?*灏氭湭 commit**锛?- `.gitignore` 鐢熸晥锛歚data/`銆乣state/`銆乣*.sqlite*`銆乣*.log`銆乣*.jsonl`銆乣node_modules/`銆乣*.tgz` 閮戒笉浼氳繘浠撳簱
- `LICENSE`锛圡IT锛夈€乣README.md`銆乣CHANGELOG.md`銆乣CONTRIBUTING.md`銆乣.github/workflows/ci.yml`
- 鍙戝竷鍏冩暟鎹細`name=dsh-moxi`銆乣version=0.1.0`銆乣private=false`銆乣repository/homepage/bugs`锛坄zwb0707` 寰呮浛鎹級
- 鑷锛歚node --test "test/*.test.mjs"` 鈫?45/45锛沗npm pack --dry-run` 鈫?27 鏂囦欢 / 102.3KB

## 1. 鏇挎崲浠撳簱鍦板潃閲岀殑 zwb0707

```powershell
cd D:\her\packages\dsh-moxi
$owner = '浣犵殑GitHub璐﹀彿'
(Get-Content package.json -Raw).Replace('zwb0707', $owner) | Set-Content package.json -NoNewline
```

## 2. 棣栨鎻愪氦

```powershell
cd D:\her\packages\dsh-moxi
git add -A
git -c user.name="Moxi contributors" -c user.email="noreply@example.com" commit -m "feat: initial dsh-moxi plugin (51 tools, gateway, agent turn, purpose loop)"
```

## 3. 寤鸿繙绔苟鎺ㄩ€?
```powershell
# 鍏堝湪 GitHub 涓婂缓绌轰粨搴?dsh-moxi锛堜笉瑕佸甫 README/License锛岄伩鍏嶅啿绐侊級
git remote add origin https://github.com/<owner>/dsh-moxi.git
git push -u origin main
```

鐢?SSH 鐨勮瘽鎶?`origin` 鎹㈡垚 `git@github.com:<owner>/dsh-moxi.git`銆?
## 4. 涓婁紶鍚庢牳瀵?
1. GitHub 涓?`Actions 鈫?ci` 璺戠豢锛坲buntu + windows 脳 node 22锛歚node --check` 鈫?`node --test` 鈫?`npm pack --dry-run`锛夈€?2. 浠撳簱閲屾悳 `D:\her`銆乣3030887571`銆乣绠浮鏈坄锛氬簲涓?0 鍛戒腑锛坄test/packaging.test.mjs` 宸叉湰鍦版柇瑷€锛夈€?3. 椤甸潰涓娿€孉bout銆嶅～鎻忚堪 + 鍕鹃€?MIT license锛堝厓鏁版嵁宸插甫锛夈€?
## 5. 瑁呭埌 DSH 楠屾敹锛堝彂甯冨悗锛?
```powershell
# 鏈湴鐩綍瀹夎锛欴SH 鈫?鎻掍欢 鈫?娣诲姞鎻掍欢 鈫?閫?D:\her\packages\dsh-moxi
# 鎴栦粠 npm锛歞sh plugin add dsh-moxi
```

瑁呭畬鍚庣‘璁わ細

- 宸ュ叿鍒楄〃閲屽嚭鐜?51 涓?`moxi_*`
- `moxi_health` 鑳芥姤鍑哄悇椤规帴绾跨姸鎬侊紙QQ 缃戝叧/澶ц剳/鎶栭煶/鑱旂綉锛?- **鍒囨崲鏃跺厛鍋滅敤鏃?`@local/her-douyin`**锛屽惁鍒欏畠鐨?50 涓悓鍚?`moxi_*` 浼氳窡鏂版彃浠舵墦鏋?
## 6. 涔嬪悗鍙戠増

```powershell
# 鏀?version锛堣涔夊寲锛夛紝鍐?CHANGELOG锛岀劧鍚?npm publish --access public
git tag v0.1.0 && git push --tags
```
