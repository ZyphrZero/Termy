/**
 * 预设脚本图标工具
 */

import { setIcon } from 'obsidian';
import type { SimpleIcon } from 'simple-icons';
import * as simpleIcons from 'simple-icons';

const SIMPLE_ICON_MAP: Record<string, SimpleIcon> = {};
const SIMPLE_ICON_ORDER: string[] = [];

const registerSimpleIcon = (key: string, exportName: string): void => {
  const icon = (simpleIcons as Record<string, SimpleIcon>)[exportName];
  if (!icon) return;
  SIMPLE_ICON_MAP[key] = icon;
  SIMPLE_ICON_ORDER.push(key);
};

registerSimpleIcon('openai', 'siOpenai');
registerSimpleIcon('google', 'siGoogle');
registerSimpleIcon('claude', 'siClaude');
registerSimpleIcon('anthropic', 'siAnthropic');
registerSimpleIcon('cohere', 'siCohere');
registerSimpleIcon('mistral', 'siMistralai');
registerSimpleIcon('perplexity', 'siPerplexity');
registerSimpleIcon('huggingface', 'siHuggingface');
registerSimpleIcon('replicate', 'siReplicate');
registerSimpleIcon('together', 'siTogether');
registerSimpleIcon('meta', 'siMeta');
registerSimpleIcon('nvidia', 'siNvidia');
registerSimpleIcon('intel', 'siIntel');
registerSimpleIcon('amd', 'siAmd');
registerSimpleIcon('apple', 'siApple');
registerSimpleIcon('microsoft', 'siMicrosoft');
registerSimpleIcon('openaiapi', 'siOpenai');
registerSimpleIcon('github', 'siGithub');
registerSimpleIcon('gitlab', 'siGitlab');
registerSimpleIcon('bitbucket', 'siBitbucket');
registerSimpleIcon('azure', 'siMicrosoftazure');
registerSimpleIcon('aws', 'siAmazonaws');
registerSimpleIcon('gcp', 'siGooglecloud');
registerSimpleIcon('ibm', 'siIbm');
registerSimpleIcon('oracle', 'siOracle');
registerSimpleIcon('digitalocean', 'siDigitalocean');
registerSimpleIcon('alicloud', 'siAlibabacloud');
registerSimpleIcon('tencentcloud', 'siTencentcloud');
registerSimpleIcon('vercel', 'siVercel');
registerSimpleIcon('netlify', 'siNetlify');
registerSimpleIcon('cloudflare', 'siCloudflare');
registerSimpleIcon('railway', 'siRailway');
registerSimpleIcon('render', 'siRender');
registerSimpleIcon('flyio', 'siFlydotio');
registerSimpleIcon('supabase', 'siSupabase');
registerSimpleIcon('firebase', 'siFirebase');
registerSimpleIcon('mongodb', 'siMongodb');
registerSimpleIcon('postgresql', 'siPostgresql');
registerSimpleIcon('mysql', 'siMysql');
registerSimpleIcon('redis', 'siRedis');
registerSimpleIcon('sqlite', 'siSqlite');
registerSimpleIcon('mssql', 'siMicrosoftsqlserver');
registerSimpleIcon('elasticsearch', 'siElasticsearch');
registerSimpleIcon('kibana', 'siKibana');
registerSimpleIcon('grafana', 'siGrafana');
registerSimpleIcon('prometheus', 'siPrometheus');
registerSimpleIcon('docker', 'siDocker');
registerSimpleIcon('kubernetes', 'siKubernetes');
registerSimpleIcon('linux', 'siLinux');
registerSimpleIcon('ubuntu', 'siUbuntu');
registerSimpleIcon('debian', 'siDebian');
registerSimpleIcon('fedora', 'siFedora');
registerSimpleIcon('archlinux', 'siArchlinux');
registerSimpleIcon('react', 'siReact');
registerSimpleIcon('vue', 'siVuedotjs');
registerSimpleIcon('svelte', 'siSvelte');
registerSimpleIcon('angular', 'siAngular');
registerSimpleIcon('nextjs', 'siNextdotjs');
registerSimpleIcon('nuxt', 'siNuxtdotjs');
registerSimpleIcon('astro', 'siAstro');
registerSimpleIcon('nodejs', 'siNodedotjs');
registerSimpleIcon('typescript', 'siTypescript');
registerSimpleIcon('javascript', 'siJavascript');
registerSimpleIcon('python', 'siPython');
registerSimpleIcon('go', 'siGo');
registerSimpleIcon('rust', 'siRust');
registerSimpleIcon('java', 'siJava');
registerSimpleIcon('kotlin', 'siKotlin');
registerSimpleIcon('swift', 'siSwift');
registerSimpleIcon('php', 'siPhp');
registerSimpleIcon('ruby', 'siRuby');
registerSimpleIcon('dart', 'siDart');
registerSimpleIcon('flutter', 'siFlutter');
registerSimpleIcon('deno', 'siDeno');
registerSimpleIcon('bun', 'siBun');
registerSimpleIcon('npm', 'siNpm');
registerSimpleIcon('pnpm', 'siPnpm');
registerSimpleIcon('yarn', 'siYarn');
registerSimpleIcon('vite', 'siVite');
registerSimpleIcon('webpack', 'siWebpack');
registerSimpleIcon('rollup', 'siRollupdotjs');
registerSimpleIcon('eslint', 'siEslint');
registerSimpleIcon('prettier', 'siPrettier');
registerSimpleIcon('storybook', 'siStorybook');
registerSimpleIcon('tailwindcss', 'siTailwindcss');
registerSimpleIcon('sass', 'siSass');
registerSimpleIcon('visualstudiocode', 'siVisualstudiocode');
registerSimpleIcon('vim', 'siVim');
registerSimpleIcon('neovim', 'siNeovim');
registerSimpleIcon('jetbrains', 'siJetbrains');
registerSimpleIcon('intellij', 'siIntellijidea');
registerSimpleIcon('webstorm', 'siWebstorm');
registerSimpleIcon('pycharm', 'siPycharm');
registerSimpleIcon('goland', 'siGoland');
registerSimpleIcon('figma', 'siFigma');
registerSimpleIcon('postman', 'siPostman');
registerSimpleIcon('graphql', 'siGraphql');
registerSimpleIcon('obsidian', 'siObsidian');
registerSimpleIcon('notion', 'siNotion');
registerSimpleIcon('discord', 'siDiscord');
registerSimpleIcon('slack', 'siSlack');
registerSimpleIcon('telegram', 'siTelegram');
registerSimpleIcon('markdown', 'siMarkdown');
registerSimpleIcon('chrome', 'siGooglechrome');
registerSimpleIcon('edge', 'siMicrosoftedge');
registerSimpleIcon('firefox', 'siFirefox');
registerSimpleIcon('safari', 'siSafari');

// 更多编程语言
registerSimpleIcon('c', 'siC');
registerSimpleIcon('cplusplus', 'siCplusplus');
registerSimpleIcon('csharp', 'siCsharp');
registerSimpleIcon('dotnet', 'siDotnet');
registerSimpleIcon('elixir', 'siElixir');
registerSimpleIcon('erlang', 'siErlang');
registerSimpleIcon('haskell', 'siHaskell');
registerSimpleIcon('lua', 'siLua');
registerSimpleIcon('perl', 'siPerl');
registerSimpleIcon('r', 'siR');
registerSimpleIcon('scala', 'siScala');
registerSimpleIcon('clojure', 'siClojure');
registerSimpleIcon('julia', 'siJulia');
registerSimpleIcon('zig', 'siZig');

// 前端框架和库
registerSimpleIcon('redux', 'siRedux');
registerSimpleIcon('mobx', 'siMobx');
registerSimpleIcon('jquery', 'siJquery');
registerSimpleIcon('bootstrap', 'siBootstrap');
registerSimpleIcon('materialui', 'siMui');
registerSimpleIcon('antdesign', 'siAntdesign');
registerSimpleIcon('chakraui', 'siChakraui');
registerSimpleIcon('emotion', 'siEmotion');
registerSimpleIcon('styledcomponents', 'siStyledcomponents');
registerSimpleIcon('less', 'siLess');
registerSimpleIcon('stylus', 'siStylus');
registerSimpleIcon('postcss', 'siPostcss');

// 后端框架
registerSimpleIcon('express', 'siExpress');
registerSimpleIcon('fastify', 'siFastify');
registerSimpleIcon('nestjs', 'siNestjs');
registerSimpleIcon('django', 'siDjango');
registerSimpleIcon('flask', 'siFlask');
registerSimpleIcon('fastapi', 'siFastapi');
registerSimpleIcon('spring', 'siSpring');
registerSimpleIcon('springboot', 'siSpringboot');
registerSimpleIcon('laravel', 'siLaravel');
registerSimpleIcon('symfony', 'siSymfony');
registerSimpleIcon('rails', 'siRubyonrails');
registerSimpleIcon('gin', 'siGin');
registerSimpleIcon('fiber', 'siGo');

// 测试工具
registerSimpleIcon('jest', 'siJest');
registerSimpleIcon('vitest', 'siVitest');
registerSimpleIcon('mocha', 'siMocha');
registerSimpleIcon('cypress', 'siCypress');
registerSimpleIcon('playwright', 'siPlaywright');
registerSimpleIcon('selenium', 'siSelenium');
registerSimpleIcon('pytest', 'siPytest');
registerSimpleIcon('junit', 'siJunit5');

// 数据库和缓存
registerSimpleIcon('cassandra', 'siApachecassandra');
registerSimpleIcon('couchdb', 'siApachecouchdb');
registerSimpleIcon('neo4j', 'siNeo4j');
registerSimpleIcon('influxdb', 'siInfluxdb');
registerSimpleIcon('mariadb', 'siMariadb');
registerSimpleIcon('cockroachdb', 'siCockroachlabs');
registerSimpleIcon('dynamodb', 'siAmazondynamodb');
registerSimpleIcon('memcached', 'siMemcached');

// DevOps 和 CI/CD
registerSimpleIcon('jenkins', 'siJenkins');
registerSimpleIcon('githubactions', 'siGithubactions');
registerSimpleIcon('gitlab-ci', 'siGitlab');
registerSimpleIcon('circleci', 'siCircleci');
registerSimpleIcon('travis', 'siTravisci');
registerSimpleIcon('terraform', 'siTerraform');
registerSimpleIcon('ansible', 'siAnsible');
registerSimpleIcon('vagrant', 'siVagrant');
registerSimpleIcon('helm', 'siHelm');
registerSimpleIcon('argocd', 'siArgo');
registerSimpleIcon('nginx', 'siNginx');
registerSimpleIcon('apache', 'siApache');
registerSimpleIcon('caddy', 'siCaddy');

// 消息队列和流处理
registerSimpleIcon('rabbitmq', 'siRabbitmq');
registerSimpleIcon('kafka', 'siApachekafka');
registerSimpleIcon('pulsar', 'siApachepulsar');
registerSimpleIcon('nats', 'siNats');

// 监控和日志
registerSimpleIcon('datadog', 'siDatadog');
registerSimpleIcon('newrelic', 'siNewrelic');
registerSimpleIcon('sentry', 'siSentry');
registerSimpleIcon('splunk', 'siSplunk');
registerSimpleIcon('logstash', 'siLogstash');

// AI/ML 工具
registerSimpleIcon('tensorflow', 'siTensorflow');
registerSimpleIcon('pytorch', 'siPytorch');
registerSimpleIcon('keras', 'siKeras');
registerSimpleIcon('scikitlearn', 'siScikitlearn');
registerSimpleIcon('jupyter', 'siJupyter');
registerSimpleIcon('anaconda', 'siAnaconda');
registerSimpleIcon('pandas', 'siPandas');
registerSimpleIcon('numpy', 'siNumpy');

// 版本控制和协作
registerSimpleIcon('git', 'siGit');
registerSimpleIcon('subversion', 'siSubversion');
registerSimpleIcon('mercurial', 'siMercurial');
registerSimpleIcon('jira', 'siJira');
registerSimpleIcon('confluence', 'siConfluence');
registerSimpleIcon('trello', 'siTrello');
registerSimpleIcon('asana', 'siAsana');
registerSimpleIcon('linear', 'siLinear');

// 设计和原型工具
registerSimpleIcon('sketch', 'siSketch');
registerSimpleIcon('adobexd', 'siAdobexd');
registerSimpleIcon('adobephotoshop', 'siAdobephotoshop');
registerSimpleIcon('adobeillustrator', 'siAdobeillustrator');
registerSimpleIcon('blender', 'siBlender');
registerSimpleIcon('canva', 'siCanva');

// 移动开发
registerSimpleIcon('android', 'siAndroid');
registerSimpleIcon('ios', 'siIos');
registerSimpleIcon('reactnative', 'siReact');
registerSimpleIcon('ionic', 'siIonic');
registerSimpleIcon('xamarin', 'siXamarin');
registerSimpleIcon('cordova', 'siApachecordova');

// 游戏开发
registerSimpleIcon('unity', 'siUnity');
registerSimpleIcon('unrealengine', 'siUnrealengine');
registerSimpleIcon('godot', 'siGodotengine');

// 区块链
registerSimpleIcon('ethereum', 'siEthereum');
registerSimpleIcon('bitcoin', 'siBitcoin');
registerSimpleIcon('solidity', 'siSolidity');
registerSimpleIcon('web3', 'siWeb3dotjs');

// 通讯和社交
registerSimpleIcon('twitter', 'siX');
registerSimpleIcon('x', 'siX');
registerSimpleIcon('linkedin', 'siLinkedin');
registerSimpleIcon('reddit', 'siReddit');
registerSimpleIcon('stackoverflow', 'siStackoverflow');
registerSimpleIcon('medium', 'siMedium');
registerSimpleIcon('devto', 'siDevdotto');
registerSimpleIcon('hashnode', 'siHashnode');
registerSimpleIcon('youtube', 'siYoutube');
registerSimpleIcon('twitch', 'siTwitch');

// 支付和电商
registerSimpleIcon('stripe', 'siStripe');
registerSimpleIcon('paypal', 'siPaypal');
registerSimpleIcon('shopify', 'siShopify');
registerSimpleIcon('woocommerce', 'siWoocommerce');

// 其他工具
registerSimpleIcon('homebrew', 'siHomebrew');
registerSimpleIcon('chocolatey', 'siChocolatey');
registerSimpleIcon('winget', 'siWindows');
registerSimpleIcon('tmux', 'siTmux');
registerSimpleIcon('powershell', 'siPowershell');
registerSimpleIcon('bash', 'siGnubash');
registerSimpleIcon('zsh', 'siZsh');
registerSimpleIcon('fish', 'siFish');
registerSimpleIcon('alacritty', 'siAlacritty');
registerSimpleIcon('iterm2', 'siIterm2');
registerSimpleIcon('wezterm', 'siWezterm');
registerSimpleIcon('hyper', 'siHyper');
registerSimpleIcon('windows', 'siWindows');
registerSimpleIcon('macos', 'siMacos');
registerSimpleIcon('android-studio', 'siAndroidstudio');
registerSimpleIcon('xcode', 'siXcode');
registerSimpleIcon('emacs', 'siGnuemacs');
registerSimpleIcon('atom', 'siAtom');
registerSimpleIcon('sublimetext', 'siSublimetext');
registerSimpleIcon('notepadplusplus', 'siNotepadplusplus');

// 更多云服务和平台
registerSimpleIcon('heroku', 'siHeroku');
registerSimpleIcon('linode', 'siLinode');
registerSimpleIcon('vultr', 'siVultr');
registerSimpleIcon('ovh', 'siOvh');
registerSimpleIcon('hetzner', 'siHetzner');
registerSimpleIcon('scaleway', 'siScaleway');
registerSimpleIcon('cloudways', 'siCloudways');
registerSimpleIcon('planetscale', 'siPlanetscale');
registerSimpleIcon('neon', 'siNeon');
registerSimpleIcon('railway-app', 'siRailway');
registerSimpleIcon('cyclic', 'siCyclic');

// 内容管理系统
registerSimpleIcon('wordpress', 'siWordpress');
registerSimpleIcon('drupal', 'siDrupal');
registerSimpleIcon('joomla', 'siJoomla');
registerSimpleIcon('ghost', 'siGhost');
registerSimpleIcon('strapi', 'siStrapi');
registerSimpleIcon('contentful', 'siContentful');
registerSimpleIcon('sanity', 'siSanity');
registerSimpleIcon('prismic', 'siPrismic');
registerSimpleIcon('directus', 'siDirectus');

// API 和后端服务
registerSimpleIcon('hasura', 'siHasura');
registerSimpleIcon('appwrite', 'siAppwrite');
registerSimpleIcon('pocketbase', 'siPocketbase');
registerSimpleIcon('parse', 'siParse');
registerSimpleIcon('backendless', 'siBackendless');
registerSimpleIcon('amplify', 'siAwsamplify');
registerSimpleIcon('convex', 'siConvex');

// 搜索引擎
registerSimpleIcon('algolia', 'siAlgolia');
registerSimpleIcon('meilisearch', 'siMeilisearch');
registerSimpleIcon('typesense', 'siTypesense');
registerSimpleIcon('solr', 'siApachesolr');

// 邮件服务
registerSimpleIcon('sendgrid', 'siSendgrid');
registerSimpleIcon('mailgun', 'siMailgun');
registerSimpleIcon('postmark', 'siPostmark');
registerSimpleIcon('resend', 'siResend');
registerSimpleIcon('gmail', 'siGmail');
registerSimpleIcon('outlook', 'siMicrosoftoutlook');
registerSimpleIcon('protonmail', 'siProtonmail');

// 认证和授权
registerSimpleIcon('auth0', 'siAuth0');
registerSimpleIcon('okta', 'siOkta');
registerSimpleIcon('keycloak', 'siKeycloak');
registerSimpleIcon('clerk', 'siClerk');
registerSimpleIcon('supertokens', 'siSupertokens');

// 分析和追踪
registerSimpleIcon('googleanalytics', 'siGoogleanalytics');
registerSimpleIcon('plausible', 'siPlausible');
registerSimpleIcon('umami', 'siUmami');
registerSimpleIcon('mixpanel', 'siMixpanel');
registerSimpleIcon('amplitude', 'siAmplitude');
registerSimpleIcon('segment', 'siSegment');
registerSimpleIcon('hotjar', 'siHotjar');

// 文档和知识库
registerSimpleIcon('gitbook', 'siGitbook');
registerSimpleIcon('docusaurus', 'siDocusaurus');
registerSimpleIcon('readthedocs', 'siReadthedocs');
registerSimpleIcon('mkdocs', 'siMaterialformkdocs');
registerSimpleIcon('sphinx', 'siSphinx');
registerSimpleIcon('vuepress', 'siVuedotjs');
registerSimpleIcon('docsify', 'siDocsify');

// 静态站点生成器
registerSimpleIcon('gatsby', 'siGatsby');
registerSimpleIcon('hugo', 'siHugo');
registerSimpleIcon('jekyll', 'siJekyll');
registerSimpleIcon('eleventy', 'siEleventy');
registerSimpleIcon('hexo', 'siHexo');
registerSimpleIcon('pelican', 'siPelican');
registerSimpleIcon('gridsome', 'siGridsome');

// 包管理器和工具
registerSimpleIcon('cargo', 'siRust');
registerSimpleIcon('composer', 'siComposer');
registerSimpleIcon('maven', 'siApachemaven');
registerSimpleIcon('gradle', 'siGradle');
registerSimpleIcon('pip', 'siPypi');
registerSimpleIcon('poetry', 'siPoetry');
registerSimpleIcon('conda', 'siAnaconda');
registerSimpleIcon('nuget', 'siNuget');
registerSimpleIcon('cocoapods', 'siCocoapods');
registerSimpleIcon('carthage', 'siCarthage');

// 代码质量和安全
registerSimpleIcon('sonarqube', 'siSonarqube');
registerSimpleIcon('snyk', 'siSnyk');
registerSimpleIcon('dependabot', 'siDependabot');
registerSimpleIcon('renovate', 'siRenovatebot');
registerSimpleIcon('codecov', 'siCodecov');
registerSimpleIcon('coveralls', 'siCoveralls');

// 容器和虚拟化
registerSimpleIcon('podman', 'siPodman');
registerSimpleIcon('containerd', 'siContainerd');
registerSimpleIcon('rancher', 'siRancher');
registerSimpleIcon('openshift', 'siRedhatopenshift');
registerSimpleIcon('nomad', 'siNomad');
registerSimpleIcon('virtualbox', 'siVirtualbox');
registerSimpleIcon('vmware', 'siVmware');
registerSimpleIcon('qemu', 'siQemu');

// 网络和 CDN
registerSimpleIcon('fastly', 'siFastly');
registerSimpleIcon('akamai', 'siAkamai');
registerSimpleIcon('bunnycdn', 'siBunnydotnet');
registerSimpleIcon('jsdelivr', 'siJsdelivr');
registerSimpleIcon('unpkg', 'siUnpkg');

// 实时通信
registerSimpleIcon('pusher', 'siPusher');
registerSimpleIcon('ably', 'siAbly');
registerSimpleIcon('socketio', 'siSocketdotio');
registerSimpleIcon('webrtc', 'siWebrtc');
registerSimpleIcon('twilio', 'siTwilio');
registerSimpleIcon('vonage', 'siVonage');

// 地图和位置服务
registerSimpleIcon('googlemaps', 'siGooglemaps');
registerSimpleIcon('mapbox', 'siMapbox');
registerSimpleIcon('openstreetmap', 'siOpenstreetmap');
registerSimpleIcon('leaflet', 'siLeaflet');

// 图表和可视化
registerSimpleIcon('chartjs', 'siChartdotjs');
registerSimpleIcon('d3', 'siD3dotjs');
registerSimpleIcon('plotly', 'siPlotly');
registerSimpleIcon('apexcharts', 'siApexcharts');
registerSimpleIcon('echarts', 'siApacheecharts');
registerSimpleIcon('tableau', 'siTableau');
registerSimpleIcon('powerbi', 'siPowerbi');
registerSimpleIcon('looker', 'siLooker');
registerSimpleIcon('metabase', 'siMetabase');

// 表单和调查
registerSimpleIcon('typeform', 'siTypeform');
registerSimpleIcon('googleforms', 'siGoogleforms');
registerSimpleIcon('surveymonkey', 'siSurveymonkey');
registerSimpleIcon('jotform', 'siJotform');

// 自动化和集成
registerSimpleIcon('zapier', 'siZapier');
registerSimpleIcon('ifttt', 'siIfttt');
registerSimpleIcon('n8n', 'siN8n');
registerSimpleIcon('make', 'siMake');
registerSimpleIcon('airflow', 'siApacheairflow');
registerSimpleIcon('prefect', 'siPrefect');

// 游戏和娱乐平台
registerSimpleIcon('steam', 'siSteam');
registerSimpleIcon('epicgames', 'siEpicgames');
registerSimpleIcon('itch', 'siItchdotio');
registerSimpleIcon('roblox', 'siRoblox');
registerSimpleIcon('minecraft', 'siMinecraft');

// 音视频处理
registerSimpleIcon('ffmpeg', 'siFfmpeg');
registerSimpleIcon('obs', 'siObsstudio');
registerSimpleIcon('audacity', 'siAudacity');
registerSimpleIcon('davinciresolve', 'siDavinciresolve');
registerSimpleIcon('adobepremiere', 'siAdobepremierepro');
registerSimpleIcon('adobeaftereffects', 'siAdobeaftereffects');

// 3D 和 CAD
registerSimpleIcon('autodesk', 'siAutodesk');
registerSimpleIcon('autocad', 'siAutocad');
registerSimpleIcon('fusion360', 'siAutodesk');
registerSimpleIcon('solidworks', 'siSolidworks');
registerSimpleIcon('freecad', 'siFreecad');
registerSimpleIcon('openscad', 'siOpenscad');
registerSimpleIcon('threejs', 'siThreedotjs');
registerSimpleIcon('babylonjs', 'siBabylondotjs');

// 硬件和嵌入式
registerSimpleIcon('arduino', 'siArduino');
registerSimpleIcon('raspberrypi', 'siRaspberrypi');
registerSimpleIcon('espressif', 'siEspressif');
registerSimpleIcon('stmicroelectronics', 'siStmicroelectronics');
registerSimpleIcon('arm', 'siArm');
registerSimpleIcon('risc-v', 'siRiscv');

// 科学计算
registerSimpleIcon('matlab', 'siMathworks');
registerSimpleIcon('octave', 'siOctave');
registerSimpleIcon('sagemath', 'siSagemath');
registerSimpleIcon('wolfram', 'siWolframmathematica');
registerSimpleIcon('latex', 'siLatex');
registerSimpleIcon('overleaf', 'siOverleaf');

// 办公和生产力
registerSimpleIcon('googledrive', 'siGoogledrive');
registerSimpleIcon('dropbox', 'siDropbox');
registerSimpleIcon('onedrive', 'siMicrosoftonedrive');
registerSimpleIcon('box', 'siBox');
registerSimpleIcon('nextcloud', 'siNextcloud');
registerSimpleIcon('owncloud', 'siOwncloud');
registerSimpleIcon('airtable', 'siAirtable');
registerSimpleIcon('monday', 'siMondaydotcom');
registerSimpleIcon('clickup', 'siClickup');
registerSimpleIcon('basecamp', 'siBasecamp');

// 电子商务和支付
registerSimpleIcon('square', 'siSquare');
registerSimpleIcon('adyen', 'siAdyen');
registerSimpleIcon('klarna', 'siKlarna');
registerSimpleIcon('alipay', 'siAlipay');
registerSimpleIcon('wechat', 'siWechat');
registerSimpleIcon('venmo', 'siVenmo');
registerSimpleIcon('cashapp', 'siCashapp');

// 营销和 SEO
registerSimpleIcon('mailchimp', 'siMailchimp');
registerSimpleIcon('hubspot', 'siHubspot');
registerSimpleIcon('salesforce', 'siSalesforce');
registerSimpleIcon('semrush', 'siSemrush');
registerSimpleIcon('ahrefs', 'siAhrefs');
registerSimpleIcon('moz', 'siMoz');

// 学习平台
registerSimpleIcon('coursera', 'siCoursera');
registerSimpleIcon('udemy', 'siUdemy');
registerSimpleIcon('edx', 'siEdx');
registerSimpleIcon('khanacademy', 'siKhanacademy');
registerSimpleIcon('codecademy', 'siCodecademy');
registerSimpleIcon('freecodecamp', 'siFreecodecamp');
registerSimpleIcon('leetcode', 'siLeetcode');
registerSimpleIcon('hackerrank', 'siHackerrank');
registerSimpleIcon('codewars', 'siCodewars');

// 新闻和媒体
registerSimpleIcon('substack', 'siSubstack');
registerSimpleIcon('patreon', 'siPatreon');
registerSimpleIcon('kofi', 'siKofi');
registerSimpleIcon('buymeacoffee', 'siBuymeacoffee');
registerSimpleIcon('gumroad', 'siGumroad');

// 浏览器扩展和工具
registerSimpleIcon('tampermonkey', 'siTampermonkey');
registerSimpleIcon('greasyfork', 'siGreasyfork');
registerSimpleIcon('stylus-ext', 'siStylus');

// 更多操作系统和发行版
registerSimpleIcon('centos', 'siCentos');
registerSimpleIcon('redhat', 'siRedhat');
registerSimpleIcon('opensuse', 'siOpensuse');
registerSimpleIcon('gentoo', 'siGentoo');
registerSimpleIcon('manjaro', 'siManjaro');
registerSimpleIcon('kalilinux', 'siKalilinux');
registerSimpleIcon('alpine', 'siAlpinelinux');
registerSimpleIcon('nixos', 'siNixos');
registerSimpleIcon('freebsd', 'siFreebsd');
registerSimpleIcon('openbsd', 'siOpenbsd');

// 桌面环境
registerSimpleIcon('gnome', 'siGnome');
registerSimpleIcon('kde', 'siKde');
registerSimpleIcon('xfce', 'siXfce');

// 更多开发工具
registerSimpleIcon('insomnia', 'siInsomnia');
registerSimpleIcon('httpie', 'siHttpie');
registerSimpleIcon('bruno', 'siBruno');
registerSimpleIcon('hoppscotch', 'siHoppscotch');
registerSimpleIcon('swagger', 'siSwagger');
registerSimpleIcon('openapi', 'siOpenapiinitiative');
registerSimpleIcon('redoc', 'siRedoc');

// 字体和图标
registerSimpleIcon('fontawesome', 'siFontawesome');
registerSimpleIcon('googlefonts', 'siGooglefonts');
registerSimpleIcon('iconify', 'siIconify');
registerSimpleIcon('simpleicons', 'siSimpleicons');

// 其他实用工具
registerSimpleIcon('regex', 'siRegexdotcom');
registerSimpleIcon('json', 'siJson');
registerSimpleIcon('yaml', 'siYaml');
registerSimpleIcon('toml', 'siToml');
registerSimpleIcon('xml', 'siXml');
registerSimpleIcon('csv', 'siCsv');

const DEFAULT_ICON_OPTIONS = [
  'sparkles',
  'terminal',
  'wand-2',
  'bot',
  'cpu',
  'command',
  'code',
  'rocket',
  'zap',
  'activity',
  'settings',
];

export const PRESET_SCRIPT_ICON_OPTIONS = [
  ...SIMPLE_ICON_ORDER,
  ...DEFAULT_ICON_OPTIONS,
];

export function isCustomPresetScriptIcon(iconName: string): boolean {
  const lookup = iconName.toLowerCase();
  return lookup in SIMPLE_ICON_MAP;
}

export function renderPresetScriptIcon(el: HTMLElement, iconName: string): void {
  const raw = (iconName || 'terminal').trim();
  const lookup = raw.toLowerCase();
  el.innerHTML = '';
  if (isCustomPresetScriptIcon(raw)) {
    const icon = SIMPLE_ICON_MAP[lookup];
    const color = icon.hex ? `#${icon.hex}` : 'currentColor';
    el.innerHTML = `<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" style=\"color:${color}\"><path fill=\"currentColor\" d=\"${icon.path}\"></path></svg>`;
    el.classList.add('preset-script-custom-icon');
  } else {
    el.classList.remove('preset-script-custom-icon');
    setIcon(el, raw);
  }
}

export function resolveMenuIconName(iconName: string): string {
  const raw = (iconName || 'terminal').trim();
  if (isCustomPresetScriptIcon(raw)) {
    return 'terminal';
  }
  return raw;
}
