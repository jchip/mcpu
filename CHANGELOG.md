# 12/15/2025

## Packages

-   `@mcpu/cli@0.2.19` `(0.2.18 => 0.2.19)`

## Commits

-   `packages/mcpu-cli`

    -   MCU-100: Replace custom logging with pino [commit](/commit/fea684f7367c176991b1b1a484d36ffd4e088fc0)
    -   Add antigravity MCP config support [commit](/commit/94956372ab13e6cc76eabbba7d9d343a952898af)
    -   Add mcpu-mcp startup and shutdown logging [commit](/commit/d04c3781ab550b934e032ff1fb73cd4e9a4bb238)
    -   MCU-99: Add per-instance server operation logging [commit](/commit/a396a03b66f4d33477398bc89941901aef6dfa33)
    -   Update batch docs to reflect per-connection parallelism [commit](/commit/e5d5a1d7f151b40e4a85b36c9a5139d87088850e)
    -   Improve mux tool description clarity [commit](/commit/9eadf3c01babc799949d1b0114cf22f0b73c9468)

# 12/14/2025

## Packages

-   `@mcpu/cli@0.2.18` `(0.2.17 => 0.2.18)`

## Commits

-   `packages/mcpu-cli`

    -   MCU-91: Support multiple connection instances per server [commit](/commit/b2acb0bb0ee3153f75c3e194f11b252cbd8d56ea)
    -   Remove unnecessary string parsing for params [commit](/commit/0f4211d5b9512103ba89157f97f18f33fa13abeb)
    -   Unify params for all mux commands, improve tool description [commit](/commit/450cd961a44d325c425591f8aae37ca83813adb3)
    -   fix tests [commit](/commit/d4a0359fa353d34776ddc5d30adad96962cbbff3)
    -   MCU-83: Replace catch (error: any) with proper type narrowing [commit](/commit/1e621940612e384f03f064b9230c6f575e50a0e2)
    -   MCU-90: Log warnings for config validation errors [commit](/commit/4ec2f3346ff67a8f3316d754b223eacc8c369c83)
    -   MCU-89: Fix memory leak in ConnectionPool connectionInfo map [commit](/commit/29a4f5e371ebf362df40f121b4f617cdb122631f)
    -   MCU-88: Fix orphaned daemon process accumulation [commit](/commit/ce41b79b48c089eeb23d90790608f986ddd564b5)
    -   MCU-84: Fix dangling promise in ConnectionPool.refreshCacheAsync() [commit](/commit/8fee967eb06fad8c73223bb0f205038d53cddee2)
    -   MCU-86: Add validation for IPC message handling in exec worker [commit](/commit/3477e18daeade4bbce22692f917119125e510b1f)
    -   MCU-82: Add input validation for cwd parameter in exec command [commit](/commit/aff5e9174bca8bf7da91446f8f5c35044ce46d03)
    -   MCU-80: Fix race condition in ConnectionPool.getConnection() [commit](/commit/b444e463901b7c107186582389ffe44ef79365a4)
    -   update readme [commit](/commit/3d84b9086a4e37ebb8ec2e13c90b431bfe055ded)

-   `MISC`

    -   add git tag template for publish [commit](/commit/7badf3da432b3891aa53ad6e672e8009fc00efd8)

# 12/13/2025

## Packages

-   `@mcpu/cli@0.2.17` `(0.2.16 => 0.2.17)`

## Commits

-   `packages/mcpu-cli`

    -   Add mcp-sleep package for testing parallel MCP execution [commit](/commit/b23b08450ff41d6c5e81c5c4d17f3fc115ce441f)
    -   MCU-79: Refactor executor to return raw results for caller formatting [commit](/commit/dcc4361b8d014c86061e0864662f5e43d92be1de)
    -   MCU-78,76,77: Exec command improvements and documentation [commit](/commit/c614282994507579019ed4e1a2a41b5610455ade)
    -   MCU-75: Fix exec worker tsx preload error [commit](/commit/695ac097374f6cbb06860c655b0276900dd16398)
    -   MCU-74: Update MCP tool schema to document exec command [commit](/commit/68cfd5e892c193dc6970250c55be757669c80aaf)
    -   MCU-58: Implement exec command with worker isolation [commit](/commit/02eafa9ff660d1e2ec68bd11290820c60814df61)
    -   MCU-56: Document batch params in MCP tool schema [commit](/commit/f783e61f108f51bdf5849b477d55ef4425c0b1a2)
    -   MCU-56: Add batch tool calls support [commit](/commit/a29ddee5469cffe8575f41f486a4b4a244460839)

-   `packages/mcp-sleep`

    -   Add mcp-sleep package for testing parallel MCP execution [commit](/commit/b23b08450ff41d6c5e81c5c4d17f3fc115ce441f)

-   `MISC`

    -   chore: update dep [commit](/commit/3da8f5fc465a18c1b6b4eb6744ca98719b459d97)

# 12/12/2025

## Packages

-   `@mcpu/cli@0.2.16` `(0.2.15 => 0.2.16)`
-   `@mcpu/tacks@0.1.8` `(0.1.7 => 0.1.8)`

## Commits

-   `packages/mcpu-cli`

    -   Improve mcpu setup: add Cursor support, better output, skip circular mcpu ref [commit](/commit/a6e2c948945042030adc0a16c00a24288f304273)
    -   MCU-69: Fix params JSON string parsing in daemon /cli endpoint [commit](/commit/e21213be405e7936e3ee791d6fc7d9406eaee22d)
    -   Add Cursor MCP config support to mcpu setup [commit](/commit/dbb12899f728b8d205ea6a38a86004194b446279)
    -   [Publish] [commit](/commit/55e14ea786efac1a06d549690dcb80e64181b07d)
    -   update muxer diagram and readme [commit](/commit/02e6b9bc4f2958f8ed924dc10b12fc594e3cb2f2)

-   `packages/tacks`

    -   [Publish] [commit](/commit/55e14ea786efac1a06d549690dcb80e64181b07d)
    -   Expose full nested JSON schema for tacks MCP tool [commit](/commit/908db51e460ba4a0c1d4c5c1e0a39be34a49f8aa)

-   `MISC`

    -   Update changelog [commit](/commit/2e643d8f1b220ac85d6ceb841e36e68c65d5bc15)
    -   Update changelog [commit](/commit/749c0b6244a7b565cbe9abcc415ca0dcf78187ad)

# 12/11/2025

## Packages

-   `@mcpu/cli@0.2.15` `(0.2.14 => 0.2.15)`
-   `@mcpu/tacks@0.1.7` `(0.1.6 => 0.1.7)`

## Commits

-   `packages/mcpu-cli`

    -   update muxer diagram and readme [commit](/commit/02e6b9bc4f2958f8ed924dc10b12fc594e3cb2f2)

-   `packages/tacks`

    -   Expose full nested JSON schema for tacks MCP tool [commit](/commit/908db51e460ba4a0c1d4c5c1e0a39be34a49f8aa)

-   `MISC`

    -   Update changelog [commit](/commit/749c0b6244a7b565cbe9abcc415ca0dcf78187ad)

# 12/11/2025

## Packages

-   `@mcpu/cli@0.2.15` `(0.2.14 => 0.2.15)`
-   `@mcpu/tacks@0.1.7` `(0.1.6 => 0.1.7)`

## Commits

-   `packages/mcpu-cli`

    -   update muxer diagram and readme [commit](/commit/02e6b9bc4f2958f8ed924dc10b12fc594e3cb2f2)

-   `packages/tacks`

    -   Expose full nested JSON schema for tacks MCP tool [commit](/commit/908db51e460ba4a0c1d4c5c1e0a39be34a49f8aa)

# 12/9/2025

## Packages

-   `@mcpu/cli@0.2.14` `(0.2.13 => 0.2.14)`
-   `@mcpu/tacks@0.1.6` `(0.1.5 => 0.1.6)`

## Commits

-   `packages/mcpu-cli`

    -   support HTTP config without explicit type and log config errors [commit](/commit/c655f4cab9854a02e7b88b09e5de54cf4bf459d2)
    -   add HTTP transport support to mcpu-mcp [commit](/commit/280808dcec974f2467e6d82b78cf2557e6810757)
    -   add HTTP transport integration test [commit](/commit/630414f31ba3c1a918fec52e4b9d8f7756190eab)
    -   add muxer explanation and diagram to readme [commit](/commit/e8bf30487dcea9a016677fab6441edc6df7014aa)

-   `packages/tacks`

    -   TSK-1: Implement GitHub-style query syntax for issue search [commit](/commit/d77acf08c17b8a1a90beb3a5d6fcc151c9c76b1b)
    -   update tacks readme [commit](/commit/fa853f6a0123ea4decaf20d46ed037d60224a814)

# 12/8/2025

## Packages

-   `@mcpu/cli@0.2.13` `(0.2.12 => 0.2.13)`
-   `@mcpu/tacks@0.1.5` `(0.1.4 => 0.1.5)`

## Commits

-   `packages/mcpu-cli`

    -   update readme and mcp add [commit](/commit/32fbf81815d0ab5fcb5e57f4b6e17af1b401a81c)
    -   MCU-54: Add fuzzy search to servers command using Jaro-Winkler [commit](/commit/c6c1d5ae94450a881fd0fb1fa05905c533b266ac)

-   `packages/tacks`

    -   update readme and mcp add [commit](/commit/32fbf81815d0ab5fcb5e57f4b6e17af1b401a81c)
    -   tacks [commit](/commit/79f9592d4c0af3594b6af3ee315d1d17d9901d0b)

# 12/7/2025

## Packages

-   `@mcpu/cli@0.2.12` `(0.2.11 => 0.2.12)`

## Commits

-   `packages/mcpu-cli`

    -   Update README to mention Gemini CLI migration [commit](/commit/0e54527ee9bd2fe9777430e256506d92a5801310)
    -   MCU-52: Add reload command for mcpu-mcp [commit](/commit/21318a3672d4d68d96b5376e21c545e74ca8b7f5)
    -   MCU-50, MCU-51: Add Gemini CLI support and .mcpu.bak backup naming [commit](/commit/0c30bbdb18b3040e617a9c955b93d17a7f9e56b0)
    -   MCU-50: Auto-detect npx and configure Claude CLI accordingly [commit](/commit/82eb4216e29d6ff69eb01cad5daffbaa189dcd89)

# 12/5/2025

## Packages

-   `@mcpu/cli@0.2.11` `(0.2.10 => 0.2.11)`

## Commits

-   `packages/mcpu-cli`

    -   MCU-49: Fix manifest/JSON collision and add autoSaveResponse tests [commit](/commit/83eca7e750d12bbad8214219e53da0dd1800fdef)
    -   MCU-49: Add text preview under file lines in auto-save output [commit](/commit/874b578472ce72d18ad3dbca65104b640bb5efcd)
    -   MCU-49: Clean up auto-save output format with file sizes [commit](/commit/d471913692f784c881cdbe6ec0980b0e0a9b9b42)
    -   MCU-49: Extract text/image content to separate files for better grep-ability [commit](/commit/2fdd43eb7bf6e68fbc9ccfcea9e89998e6d6a92d)
    -   MCU-49: Auto-save large responses to file with 3-level config hierarchy [commit](/commit/fc30e5fbec6a28c0f6fb6353e30a4b1acb4131a8)
    -   MCU-48: Auto-add MCPU to Claude CLI during setup [commit](/commit/cfe0880f1b7be28913431afba66f13d06ea985c7)
    -   MCU-1: Return compact JSON for --json flag [commit](/commit/a312c0f081fcbc102e182e5e2214934451f201e0)
    -   MCU-3: Add elaborate fixture-based integration tests [commit](/commit/a51212be1d742b93676af210a3a7a732c5b936cf)
    -   MCU-3: Add Claude CLI support to setup command [commit](/commit/070de5fd86a05e8cf7afebf28a9830aa10ebeba4)
    -   MCU-3: Update README for agent-guide rename and setup command [commit](/commit/263288d21f47b6b11c423ccc5ad70e4d6cdfa50c)
    -   MCU-3: Add setup command for migrating MCP servers from Claude [commit](/commit/51fa4fc045aeea75822ab726a8d26dee87b071c0)
    -   MCU-13: Rename setup command to agent-guide [commit](/commit/8a406093d688458af70f012bcd3d7d6b195369c7)
    -   Include tools list in error responses when tools not yet shown for server [commit](/commit/6fc83661bb37a773ef78dbaaa11c44f951b00b77)
    -   Compact JSON output by default for MCP responses [commit](/commit/950a7fded09ea34a3ca917bf55adca497a32b1ee)

# 11/30/2025

## Packages

-   `@mcpu/cli@0.2.10` `(0.2.9 => 0.2.10)`

## Commits

-   `packages/mcpu-cli`

    -   Improve cache flag and show full params for small tool sets [commit](/commit/d975ecadc227d9cffff56301e6b243d05b410df1)
    -   Extract enums recursively from nested schema properties [commit](/commit/736bcce522fc1f661102cf8a79de89b55e4fdee3)
    -   Fix command path resolution: only resolve ./ and ../ prefixes [commit](/commit/9982fbf41c0fefca910860457cac020d1e6708f2)
    -   Refactor formatters: type abbreviations, enum refs, cleaner output [commit](/commit/16516972caad9878225272cdd0ca5d9ac9744bb6)

# 11/30/2025

## Packages

-   `@mcpu/cli@0.2.9` `(0.2.8 => 0.2.9)`

## Commits

-   `packages/mcpu-cli`

    -   update readme [commit](/commit/674af326b49705beb5532d14af05845fede93087)
    -   Add per-server requestTimeout config, increase default to 3 minutes [commit](/commit/5edc86874db531a96473ed22ad9b0a231c1352a1)
    -   Add RelaxedAjvJsonSchemaValidator to fix output schema validation errors [commit](/commit/31209eaf49894e9c6d3ae2d1fcbcf554405065ec)

-   `packages/mcpu-proxy`

    -   update readme [commit](/commit/674af326b49705beb5532d14af05845fede93087)

# 11/29/2025

## Packages

-   `@mcpu/cli@0.2.8` `(0.2.7 => 0.2.8)`
-   `xtsjs@0.1.3` `(0.1.2 => 0.1.3)`

## Commits

-   `packages/mcpu-cli`

    -   Add enabled field to MCP server config [commit](/commit/4d12da2dd62350732c026b559a2f38fcf7187354)
    -   Add mcpu-stat command and change --full-desc default [commit](/commit/9f93c4fea3947132c6bf47a320b872b0eaa50fa2)
    -   [Publish] [commit](/commit/679300d2fa86258b9d50835dd3abc1e5308ace67)
    -   Add enum deduplication with E1/E2 refs under each server header [commit](/commit/4375861d51657a0db52418331139731bfcc1f097)
    -   Enhance tools ARGS output with enums, ranges, defaults from descriptions [commit](/commit/baa9cb94407f5b4c6c38388dd3654ad31b6151dc)
    -   Change PARAMS to ARGS and skip if description mentions 75%+ of args [commit](/commit/dc8e28069e1d9f904989e6a303c146b25d7f93fa)
    -   Default to showing full descriptions, use --no-full-desc for summary [commit](/commit/0f59445a42d0145cff41c7eedcc1b634c092c682)
    -   Fix option naming to use kebab-case with nix-clap conventions [commit](/commit/42f43d5e36da403e1bc9d7c7c3a376f70a580571)
    -   Add --fullDesc and --skipParams options to tools command [commit](/commit/5ff029fa941a818dfe867efb42475c77c36bbe72)
    -   Show only first line of descriptions for cleaner output [commit](/commit/d71fcdebec59d93bb372f068eaf7ee4e7beef67b)
    -   Show object structure inline for better type clarity [commit](/commit/9d39cd41e6a2a1ff6b77d9d1e23479195c452192)
    -   Show required params first, then optional params [commit](/commit/fbaec216704207d3bf024c35304be154debf175a)
    -   Relax complexity thresholds to show more params inline [commit](/commit/4c950e4bb7e2342d083d80e250416232423869de)
    -   Use z for null to maintain single-letter consistency [commit](/commit/ea36bcbcd7fea4177868bbace1a40e022b9f02ba)
    -   Use n for number and spell out null for clarity [commit](/commit/5f847a29e15d717d722ebf75bc0ff3b325831ecd)
    -   Use single-letter type codes with legend for more compact output [commit](/commit/4128ae09d0d9b49ffff2a0801d1b478aabecef1d)
    -   Remove redundant header when listing tools from single server [commit](/commit/d73a679da3c92990a9a3ed391f647dc29abf974a)
    -   Add bullet points to tool listings for better scannability [commit](/commit/3c3292e7016087aa83ff126f141781517e1411f2)
    -   Show hint for complex params instead of overwhelming inline display [commit](/commit/f0f6902f1a5892cf5c5decc22f1aca50f5e0dc4e)
    -   Remove backticks from parameter names for cleaner output [commit](/commit/a9d4a154ed3a16680d4294db8741237906bbef09)
    -   Add PARAMS separator before parameter list in tools output [commit](/commit/12280c3e382ddec84b6bb622e7dc154781395b6c)
    -   Use abbreviated type names in tool parameter signatures [commit](/commit/ba3b3c8fce6f49d8517bf8956a614caf218a1c9d)
    -   Add parameter signatures to tools listing output [commit](/commit/7d96d52b8b0891edb933e2098d737e0f0b37d756)
    -   add concurrent calls test for mcpu-mcp server [commit](/commit/1ca26e6b4f87cba503adcf4337ab938d68a11b00)
    -   update README [commit](/commit/8a89b1362e04a0071e60625c28c8be7c55862adf)
    -   rename mcpu_cli tool to cli [commit](/commit/8086574c63db70f459891632da48a03c87d5c7c2)
    -   accept params as string or object for flexibility [commit](/commit/8c0d5eff8d4bccb8f5af29b1639ffce6ce43e7ec)
    -   compact mcpu_cli schema to reduce token usage [commit](/commit/2e1193a5f9d21221e8308b87e2c61b3ab01dd251)
    -   add connect/disconnect/connections commands to mcpu_cli description [commit](/commit/bf5440a52d78c330aeb12be1111212c9f2a46985)
    -   update README with mcpu-mcp MCP server usage [commit](/commit/4ce7c1c3a4b1c3228a72fd91c6528cd3e7bf0272)
    -   improve mcpu_cli tool description with commands and response format [commit](/commit/430fe57e93c2e0b8acb14e19d831eef9dbd734bf)
    -   add tests for mcpu-mcp server [commit](/commit/b9fe50c265f302ede0f607ca2477583d5ba86e96)
    -   add mcpu-mcp MCP server for stdio transport [commit](/commit/5acd56bf3cf7cdd9dc8d85a7e9e831822778d253)
    -   update dep [commit](/commit/4cd0ee36916f7cfd26d7c48f6af97899e59df7aa)
    -   add mcpu setup command and project config support [commit](/commit/1fb752ddf4ce404706143fca9ede464b798c0d6d)
    -   v0.2.5 [commit](/commit/bf5466540fd5478637b0cf39cb49b701a0907458)
    -   README [commit](/commit/81090a1e8ec3d0a41c10fac8cefd0b6e875e814a)
    -   accept yaml from file [commit](/commit/ad582c8a9952c6b3f1e923e3b24a87df0887e426)
    -   auto refresh cache [commit](/commit/38a981660ab55aa70da3c7a600bd09c03c663af6)
    -   add runtime config for MCP servers via config and call [commit](/commit/1347ac659d387f90b2f48bdb2cf579f698474d1e)
    -   @mcpu/cli v0.2.4 [commit](/commit/17348415cb5a296f6485af10513e7dbb3ee4d1cd)
    -   update dep [commit](/commit/4afdfd00779f3e785dc4a0d02057c04c3dcd4117)
    -   fix types [commit](/commit/8305652be7a6d781c73d6433ab31f0793fa68951)
    -   update README [commit](/commit/a9f08b09c7af74123607b56cda4a534c3efa2888)
    -   add --names option to tools command [commit](/commit/a57240f0a18f6d503ebc1a9a675b08445b0b43af)
    -   daemon logging and turn off auto disconnect [commit](/commit/aa9005542aa90517f7463d429bcfe204ab87a4a7)
    -   implement add mcp server command [commit](/commit/bc083f4e20b13a36fe0d7f0cbfdfbb9a34bd4ed5)
    -   fix stop command [commit](/commit/58d2af80685f14078e43a165bf6592337dd59307)
    -   v0.2.3 [commit](/commit/be8960c63f1e108017e32452add37161e9ffb20c)
    -   v0.2.2 [commit](/commit/66bef01c73113ad4007af119e259789e4e28cb04)
    -   use ppid to track daemon [commit](/commit/14dc57580d1c3d9c15bbf1bdd5139fe3372b1e10)
    -   v0.2.1 [commit](/commit/e9c482e73538c5587a58b6e306f1647ee36d2b30)
    -   fix --raw and update readme [commit](/commit/e8dcc5d871314761f1b2ba27b0083aaad7a5db79)
    -   unwrap mcp response according to spec [commit](/commit/43502cbdb1fa4f867aff5aa099d0448768c1f2f6)
    -   more updates and fixes [commit](/commit/d74528a95213223684bed54a431bba9f3d8dc938)
    -   v0.2.0 [commit](/commit/10c520cbdb0863af33730baeb3dacb4ca865cad3)
    -   updates to mcpu-cli [commit](/commit/b572293ffc4eb1652d4678a6446b08dbe6232f41)
    -   replace undici with native fetch [commit](/commit/d26f79cfa6e31d1ea26ade0e798f9dab96fe0a81)
    -   add execution context with cwd support and improve daemon CLI parsing [commit](/commit/891741202929fba09f339781cbb015dcf2a783b5)
    -   update deps [commit](/commit/627a2cd7496e8972f062ce7646c0aee3198bc8d9)
    -   v0.1.1 [commit](/commit/3d51f0c8fd70a2e7be4db2cb92f5c417568abe2a)
    -   transpile .ts [commit](/commit/964c9fa3081b3986b4dfdea21f23dda9777aa85d)
    -   v0.1.0 [commit](/commit/bcf145cfc80c629c3690d850af6f3ba5090e9646)
    -   implement remote daemon for mcpu cli [commit](/commit/21b98c10a5fe6048575c4a9f5d8b7e2ec097bded)
    -   first version [commit](/commit/1a67a4ffcfd991def28dee51dbaffdbe01e664d3)

-   `packages/mcpu-proxy`

    -   update dep [commit](/commit/0eb1ea02b5be9af38456e051e741e477562e1a21)
    -   implement remote daemon for mcpu cli [commit](/commit/21b98c10a5fe6048575c4a9f5d8b7e2ec097bded)
    -   first version [commit](/commit/1a67a4ffcfd991def28dee51dbaffdbe01e664d3)

-   `packages/xtsjs`

    -   [Publish] [commit](/commit/679300d2fa86258b9d50835dd3abc1e5308ace67)
    -   v0.1.1 [commit](/commit/cdd68a87bde08f2faeda427f5cb84583e8d8cb38)
    -   fix types [commit](/commit/8305652be7a6d781c73d6433ab31f0793fa68951)
    -   xtsjs [commit](/commit/e330a08cb84d9a447bfce3d2ee1e41083eb7b948)

-   `docs`

    -   unwrap mcp response according to spec [commit](/commit/43502cbdb1fa4f867aff5aa099d0448768c1f2f6)
    -   first version [commit](/commit/1a67a4ffcfd991def28dee51dbaffdbe01e664d3)

-   `MISC`

    -   first commit [commit](/commit/5310c33d6a6c6f781a595dc89ccde5347928b4d7)
    -   Update changelog [commit](/commit/cec60daa0bb1ae818eab75b877368d57ef090c07)
    -   update fyn/fynpo [commit](/commit/3718ba9426c50ed9b2a1cbfcafe30dece5e1e1ef)

# 11/28/2025

## Packages

-   `@mcpu/cli@0.2.6` `(0.2.5 => 0.2.6)`
-   `xtsjs@0.1.2` `(0.1.1 => 0.1.2)`

## Commits

-   `packages/mcpu-cli`

    -   Add enum deduplication with E1/E2 refs under each server header [commit](/commit/4375861d51657a0db52418331139731bfcc1f097)
    -   Enhance tools ARGS output with enums, ranges, defaults from descriptions [commit](/commit/baa9cb94407f5b4c6c38388dd3654ad31b6151dc)
    -   Change PARAMS to ARGS and skip if description mentions 75%+ of args [commit](/commit/dc8e28069e1d9f904989e6a303c146b25d7f93fa)
    -   Default to showing full descriptions, use --no-full-desc for summary [commit](/commit/0f59445a42d0145cff41c7eedcc1b634c092c682)
    -   Fix option naming to use kebab-case with nix-clap conventions [commit](/commit/42f43d5e36da403e1bc9d7c7c3a376f70a580571)
    -   Add --fullDesc and --skipParams options to tools command [commit](/commit/5ff029fa941a818dfe867efb42475c77c36bbe72)
    -   Show only first line of descriptions for cleaner output [commit](/commit/d71fcdebec59d93bb372f068eaf7ee4e7beef67b)
    -   Show object structure inline for better type clarity [commit](/commit/9d39cd41e6a2a1ff6b77d9d1e23479195c452192)
    -   Show required params first, then optional params [commit](/commit/fbaec216704207d3bf024c35304be154debf175a)
    -   Relax complexity thresholds to show more params inline [commit](/commit/4c950e4bb7e2342d083d80e250416232423869de)
    -   Use z for null to maintain single-letter consistency [commit](/commit/ea36bcbcd7fea4177868bbace1a40e022b9f02ba)
    -   Use n for number and spell out null for clarity [commit](/commit/5f847a29e15d717d722ebf75bc0ff3b325831ecd)
    -   Use single-letter type codes with legend for more compact output [commit](/commit/4128ae09d0d9b49ffff2a0801d1b478aabecef1d)
    -   Remove redundant header when listing tools from single server [commit](/commit/d73a679da3c92990a9a3ed391f647dc29abf974a)
    -   Add bullet points to tool listings for better scannability [commit](/commit/3c3292e7016087aa83ff126f141781517e1411f2)
    -   Show hint for complex params instead of overwhelming inline display [commit](/commit/f0f6902f1a5892cf5c5decc22f1aca50f5e0dc4e)
    -   Remove backticks from parameter names for cleaner output [commit](/commit/a9d4a154ed3a16680d4294db8741237906bbef09)
    -   Add PARAMS separator before parameter list in tools output [commit](/commit/12280c3e382ddec84b6bb622e7dc154781395b6c)
    -   Use abbreviated type names in tool parameter signatures [commit](/commit/ba3b3c8fce6f49d8517bf8956a614caf218a1c9d)
    -   Add parameter signatures to tools listing output [commit](/commit/7d96d52b8b0891edb933e2098d737e0f0b37d756)
    -   add concurrent calls test for mcpu-mcp server [commit](/commit/1ca26e6b4f87cba503adcf4337ab938d68a11b00)
    -   update README [commit](/commit/8a89b1362e04a0071e60625c28c8be7c55862adf)
    -   rename mcpu_cli tool to cli [commit](/commit/8086574c63db70f459891632da48a03c87d5c7c2)
    -   accept params as string or object for flexibility [commit](/commit/8c0d5eff8d4bccb8f5af29b1639ffce6ce43e7ec)
    -   compact mcpu_cli schema to reduce token usage [commit](/commit/2e1193a5f9d21221e8308b87e2c61b3ab01dd251)
    -   add connect/disconnect/connections commands to mcpu_cli description [commit](/commit/bf5440a52d78c330aeb12be1111212c9f2a46985)
    -   update README with mcpu-mcp MCP server usage [commit](/commit/4ce7c1c3a4b1c3228a72fd91c6528cd3e7bf0272)
    -   improve mcpu_cli tool description with commands and response format [commit](/commit/430fe57e93c2e0b8acb14e19d831eef9dbd734bf)
    -   add tests for mcpu-mcp server [commit](/commit/b9fe50c265f302ede0f607ca2477583d5ba86e96)
    -   add mcpu-mcp MCP server for stdio transport [commit](/commit/5acd56bf3cf7cdd9dc8d85a7e9e831822778d253)
    -   update dep [commit](/commit/4cd0ee36916f7cfd26d7c48f6af97899e59df7aa)
    -   add mcpu setup command and project config support [commit](/commit/1fb752ddf4ce404706143fca9ede464b798c0d6d)
    -   v0.2.5 [commit](/commit/bf5466540fd5478637b0cf39cb49b701a0907458)
    -   README [commit](/commit/81090a1e8ec3d0a41c10fac8cefd0b6e875e814a)
    -   accept yaml from file [commit](/commit/ad582c8a9952c6b3f1e923e3b24a87df0887e426)
    -   auto refresh cache [commit](/commit/38a981660ab55aa70da3c7a600bd09c03c663af6)
    -   add runtime config for MCP servers via config and call [commit](/commit/1347ac659d387f90b2f48bdb2cf579f698474d1e)
    -   @mcpu/cli v0.2.4 [commit](/commit/17348415cb5a296f6485af10513e7dbb3ee4d1cd)
    -   update dep [commit](/commit/4afdfd00779f3e785dc4a0d02057c04c3dcd4117)
    -   fix types [commit](/commit/8305652be7a6d781c73d6433ab31f0793fa68951)
    -   update README [commit](/commit/a9f08b09c7af74123607b56cda4a534c3efa2888)
    -   add --names option to tools command [commit](/commit/a57240f0a18f6d503ebc1a9a675b08445b0b43af)
    -   daemon logging and turn off auto disconnect [commit](/commit/aa9005542aa90517f7463d429bcfe204ab87a4a7)
    -   implement add mcp server command [commit](/commit/bc083f4e20b13a36fe0d7f0cbfdfbb9a34bd4ed5)
    -   fix stop command [commit](/commit/58d2af80685f14078e43a165bf6592337dd59307)
    -   v0.2.3 [commit](/commit/be8960c63f1e108017e32452add37161e9ffb20c)
    -   v0.2.2 [commit](/commit/66bef01c73113ad4007af119e259789e4e28cb04)
    -   use ppid to track daemon [commit](/commit/14dc57580d1c3d9c15bbf1bdd5139fe3372b1e10)
    -   v0.2.1 [commit](/commit/e9c482e73538c5587a58b6e306f1647ee36d2b30)
    -   fix --raw and update readme [commit](/commit/e8dcc5d871314761f1b2ba27b0083aaad7a5db79)
    -   unwrap mcp response according to spec [commit](/commit/43502cbdb1fa4f867aff5aa099d0448768c1f2f6)
    -   more updates and fixes [commit](/commit/d74528a95213223684bed54a431bba9f3d8dc938)
    -   v0.2.0 [commit](/commit/10c520cbdb0863af33730baeb3dacb4ca865cad3)
    -   updates to mcpu-cli [commit](/commit/b572293ffc4eb1652d4678a6446b08dbe6232f41)
    -   replace undici with native fetch [commit](/commit/d26f79cfa6e31d1ea26ade0e798f9dab96fe0a81)
    -   add execution context with cwd support and improve daemon CLI parsing [commit](/commit/891741202929fba09f339781cbb015dcf2a783b5)
    -   update deps [commit](/commit/627a2cd7496e8972f062ce7646c0aee3198bc8d9)
    -   v0.1.1 [commit](/commit/3d51f0c8fd70a2e7be4db2cb92f5c417568abe2a)
    -   transpile .ts [commit](/commit/964c9fa3081b3986b4dfdea21f23dda9777aa85d)
    -   v0.1.0 [commit](/commit/bcf145cfc80c629c3690d850af6f3ba5090e9646)
    -   implement remote daemon for mcpu cli [commit](/commit/21b98c10a5fe6048575c4a9f5d8b7e2ec097bded)
    -   first version [commit](/commit/1a67a4ffcfd991def28dee51dbaffdbe01e664d3)

-   `packages/mcpu-proxy`

    -   update dep [commit](/commit/0eb1ea02b5be9af38456e051e741e477562e1a21)
    -   implement remote daemon for mcpu cli [commit](/commit/21b98c10a5fe6048575c4a9f5d8b7e2ec097bded)
    -   first version [commit](/commit/1a67a4ffcfd991def28dee51dbaffdbe01e664d3)

-   `packages/xtsjs`

    -   v0.1.1 [commit](/commit/cdd68a87bde08f2faeda427f5cb84583e8d8cb38)
    -   fix types [commit](/commit/8305652be7a6d781c73d6433ab31f0793fa68951)
    -   xtsjs [commit](/commit/e330a08cb84d9a447bfce3d2ee1e41083eb7b948)

-   `docs`

    -   unwrap mcp response according to spec [commit](/commit/43502cbdb1fa4f867aff5aa099d0448768c1f2f6)
    -   first version [commit](/commit/1a67a4ffcfd991def28dee51dbaffdbe01e664d3)

-   `MISC`

    -   update fyn/fynpo [commit](/commit/3718ba9426c50ed9b2a1cbfcafe30dece5e1e1ef)
    -   first commit [commit](/commit/5310c33d6a6c6f781a595dc89ccde5347928b4d7)

