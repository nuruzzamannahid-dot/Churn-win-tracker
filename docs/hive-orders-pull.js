/* Hive → Churn Win Tracker: lifetime orders per business
 * ------------------------------------------------------
 * Hive is a Next.js App Router app: table data arrives as RSC "flight" text,
 * so there is no copyable JSON in the Network tab. This script asks the same
 * /orders route the Orders page uses, once per business, with your session
 * cookie — no token pasted, nothing leaves carrybee.com.
 *
 * USE
 *   1. Log in, open https://hive.carrybee.com/orders
 *   2. DevTools → Console → paste this whole file → Enter
 *   3. It self-checks, then works through 540 businesses (~4 min).
 *      Leave the tab open. It copies a CSV at the end.
 *      Clipboard blocked? Run:  copy(window.__hiveCsv)
 *
 * WHAT IT COLLECTS
 *   total orders · first order date · last order date · distinct order days
 *   (active days is derived from the distinct dates, or their span as fallback)
 *
 * SELF-CHECKS (it stops instead of lying to you)
 *   - control query with a nonsense phone: must return 0 orders
 *   - per-business: response must actually mention that business's phone
 *   If either fails it prints diagnostics and stops — send me the output.
 */
(function () {
  "use strict";

  var BUSINESSES = [["359","Aladeener Cherag","8801836102283"],["24461","মানব কল্যাণ","8801888757391"],["15954","ReviewHunt BD","8801902218358"],["23610","Deshi Drip","8801628955274"],["26277","Bulet","8801766237935"],["27284","MT Shopping","8801788400545"],["2754","KISHANI","8801771222270"],["13871","Mirror world","8801713123381"],["24995","kashmira 2.0","8801309312448"],["23717","AR Baby Cloud","8801632971014"],["25819","Rupali ava","8801905111078"],["25827","Khela Pagla","8801679453890"],["20658","PRESTIGIA","8801518378431"],["10176","Holy Touch","8801941565896"],["23212","Fit Bangla","8801601441880"],["23565","Stylica","8801709284291"],["25950","ARBOX BD","8801836844284"],["25145","Rockin Fashion","8801629701909"],["27122","Organic Shop","8801824968074"],["13822","Life Care","8801625910404"],["24580","Mahi Fashion House","8801707797737"],["23011","Baby kiddz","8801858648857"],["6621","NEXT MART","8801713960391"],["25257","MiniMuse By Inaaya","8801701041975"],["25974","Trasted by bd","8801758115251"],["23427","মরিঙ্গা গেইন","8801351573184"],["11990","Object D’art","8801778620666"],["22670","China Health Care","8801843481608"],["5594","Rayon","8801712071078"],["13287","চিঠি ঘর","8801768343017"],["24366","শখের গেজেট","8801994319739"],["24409","Babies Haven","8801916061560"],["11658","The Decor Story","8801738012117"],["20801","ARAVEL","8801892934683"],["25086","Korean Online","8801350655560"],["12478","GIFT GRAB","8801776490123"],["21916","KPGoldenlife","8801945889383"],["1827","Sweet Kiddz","8801645822020"],["25953","Bc shop","8801735490939"],["21513","Neuroclean","8801865845321"],["25762","NISHCLO","8801740126434"],["27080","Wasifinity","8801812509308"],["24108","Sanny Three pic","8801760844816"],["24796","Healinic","8801962563999"],["8469","Root corner","8801325729594"],["6444","Homey Mart","8801833394634"],["25214","Nolok","8801576605623"],["3483","UMRAF","8801758870061"],["25361","Elix","8801796246023"],["25436","Clothing Apparel Ox","8801888125638"],["27137","Desire Basket","8801813383906"],["21517","Charlie Bd","8801760081248"],["19051","zohantex","8801846622025"],["25561","Samastha's Beauty Zone","8801792434506"],["10535","Raw Stitch","8801924214837"],["26650","FIVE LINE","8801917746666"],["21960","Surprise Collection","8801515209328"],["26442","Arrow Express","8801615603695"],["25660","Muyaj organic","8801318207858"],["12194","Technen","8801410200905"],["18262","SM cosmetic","8801753761672"],["26043","সানজিদা ফ্যাশন 2:0","8801345512182"],["14292","Prijosree- প্রিজশ্রী","8801313558175"],["14286","Materials zone","8801821458010"],["25937","Gadget & Guide","8801772306676"],["13230","Voyd Men","8801580662601"],["26076","Golden Lion","8801306732911"],["1783","Gadget Nova","8801611111856"],["2942","Atal Food","8801718039498"],["7072","Dipetane Bangladesh","8801860428694"],["26598","Level Up","8801762830046"],["22874","SA Enterprise","8801600451494"],["24807","Urban Deshi","8801407329733"],["15335","Bangla Eco","8801577229100"],["24090","Tijarah Corporation","8801611500067"],["21506","মেডিসিন কর্নার 1","8801717946353"],["24501","Bd Shop","8801750457428"],["12276","Action Mart","8801618625058"],["10033","Hi Birdy & Company","8801788731005"],["24969","nawabi shop","8801717498633"],["25844","Shakil BD","8801333203175"],["24602","Erfan's Shop","8801759151355"],["27528","Medicine Shop","8801842613957"],["10758","Alyshop","8801870369409"],["25279","Diet Store","8801754308424"],["4117","Choosett","8801400570011"],["9444","JIFFHUT","8801576771508"],["16938","Tayyibat","8801540095854"],["23963","Ab Online BD 50","8801793923386"],["12348","online BD shop 120","01326882802"],["25275","Traditional & Trendy","8801980369124"],["20953","Guru Ji Hub","8801770761979"],["26496","SR SHOP","8801828349407"],["26817","OneCart BD","8801572917604"],["24635","Ilori By S","8801317338335"],["17947","Never-Basic.store","8801781017738"],["13823","Madicine Shop","8801335750526"],["5719","Alo Artisan","8801719879434"],["26171","MK Borka Mart","8801886106856"],["25748","succulent bazaar","8801602581132"],["23269","Tazkizone","8801943537797"],["26601","SR SHOP 2","8801603311071"],["2031","Offline BD","8801708011234"],["7004","0 point","8801774291115"],["11632","Shari Souda Sirajganj","8801732691253"],["22880","Zaynoor Shop","8801954279325"],["26666","হেলথ সিটি","8801778821865"],["15024","fashoin gallery by mehu","8801789124786"],["21853","BANGLADESH HAUL","8801989722265"],["23445","purlybd.com","8801918583766"],["20797","pifman","8801713613193"],["25740","cute kids","8801952852451"],["19943","Van Gari","8801930625675"],["16252","SSD jone","8801969020870"],["14480","Nowrin Fashion Gallery","8801705914385"],["24534","Salute fashion","8801777535433"],["20489","Ayora","8801600233777"],["8310","Soash","8801685060975"],["12335","Omor Faruq collection","8801629175601"],["24481","Wears & Gears","8801622650039"],["3778","H & H Business solution","8801324088335"],["25114","Organic Valley Khulna","8801917806063"],["24907","Zara & Sara","8801974444801"],["26067","Fiona Style","8801746522944"],["9484","Sabsan trend","8801631234383"],["26778","Coxsbazarshop.com","8801813037870"],["14970","Health care BDIT","8801344233447"],["17663","Bag Koi","8801620234181"],["24320","New mom & baby corner","8801320652854"],["22245","SmartNest BD","8801577550947"],["25984","ALLshop BD","8801326243520"],["14134","S.N MART","8801894206904"],["23843","Dense & Bounce","8801987546260"],["20427","Dial Story","8801780615421"],["27163","Intimate Store","8801827420059"],["2759","Mas enterprises","8801401344014"],["24998","Pukuchu","8801610785077"],["19027","Grameen Nakshi","8801710960550"],["25851","Anzum BD","8801771314135"],["15395","CITY WALK BD","8801819496662"],["25936","দেশি পরান/Unique Shop","8801625577108"],["10257","eDorji","8801701080875"],["21740","Rs Gadgets Store","8801766922559"],["23906","Avix BD","8801708615939"],["12137","Rose crafting","8801839440414"],["17901","International Online Journal Hub","8801516786983"],["19461","Chowdhury Enterprise","8801771242914"],["24638","Daibetis Care","8801329049526"],["24126","Royal Honey BD","8801814741979"],["23962","Raspberry Pi","8801772027766"],["26945","Reva Wonder","8801326602521"],["25533","Aura Decor BD","8801830067856"],["24460","ORIGINA","8801715036374"],["23970","Hayaro","8801629412737"],["19496","ICase","8801737868655"],["11626","শাড়ি কথা","8801608179715"],["20910","ALINE WEAR","8801861151577"],["6853","Kharh","8801601379556"],["17527","CGMP SHOP","8801804181754"],["24682","Ovoniia medical centre","8801885146620"],["4177","Khorid","8801858534597"],["15721","TMC Organic","8801341647586"],["12501","Aleya","8801581783269"],["8740","Mehjan","8801805226550"],["18255","DEER & DOE","8801511361477"],["24935","Nature Bazzar","8801343326066"],["24909","Timeless Touches","8801730906418"],["9280","Rain Lily","8801842167708"],["17688","আদনান ফ্যাশন","8801918925257"],["12202","Herb Life Bangladesh","8801767740879"],["25094","Offer Poka","8801973120550"],["20192","Rajkonna Jewellery","8801795313511"],["794","Elite Hub","8801867115596"],["14300","One-man Collection's","8801978677690"],["18277","ZAIR","8801783757580"],["9697","BD Basket","8801918282804"],["8643","Fieora","8801970137336"],["25860","Ovoniia Officials","8801879850669"],["24407","Inner Haven BD","8801611756299"],["28491","online shop","8801881962913"],["5053","FREEDOM BD SHOP","8801791930043"],["25101","One Stop Bazar","8801904343449"],["17205","UniqoBD","8801685685700"],["21404","Shwaad – BD","8801677266742"],["4741","Deshhat.com","8801780696969"],["24550","ওভোনিয়া বায়ু কেয়ার","8801866703472"],["23898","Green Life Solutions","8801971115009"],["23691","Mehndi By Sumaiya","8801626291700"],["5558","You & Baby","8801670504110"],["26407","Online Natrual shop602","8801881497945"],["28156","ন্যাচারাল শপ ৫০০","8801967003023"],["29376","SharkYla","8801954857574"],["27952","Safe bd","8801770019872"],["28689","Nazmul Fashion","8801998252987"],["20751","Humty Dumty","8801608039651"],["1653","Beautybooth","8801872350077"],["25372","Xiroo","8801828569660"],["28187","online bd shop 140","8801304806709"],["28129","pitha owalir pitha owala","8801722212722"],["27816","Book Owls BD","8801708612908"],["27787","Bd Smart Buy","8801616670075"],["27631","মেডিসিন হাউস","8801721371970"],["27607","E Gadget","8801773820580"],["28244","International Online Journal Hub","8801410180869"],["28316","Herbolife","8801314623147"],["28773","Royalzo","8801785652257"],["28898","Jolabd","8801623025326"],["29079","online business55","8801309409441"],["30399","কৈতান","8801337592110"],["31739","Royal Honey BD","8801772801106"],["20876","অংশুলা","8801720001588"],["24709","Perfumiosa","8801905783194"],["23202","Gift Patan","8801839677799"],["4286","Taiba fashion house 2.0","8801843426569"],["5542","Glow beauty queen","8801798146499"],["27648","Suhasini Official","8801851451271"],["8773","কৈতান","8801822119847"],["22112","Daraj.bd","8801824041970"],["24523","Parsonal Item","8801402968432"],["28648","ONLINE SHOP SNHBD","8801333708843"],["32374","Online Shop","8801575297243"],["29663","Shuveccha","8801705113080"],["28280","SMR Shop","8801959609572"],["34376","online shop","8801978714655"],["14772","Levelup Academy","8801346594840"],["18386","RS Leather BD","8801709306560"],["8365","HAWLADER LIFESTYLE","8801302636367"],["26420","Men's Bd","8801613507616"],["18934","Fly Store BD","8801969146446"],["11293","Jungleebee.com","8801628025271"],["10348","Smart Life For Women","8801603697030"],["13076","BANAI","8801799310043"],["10772","StyleX","8801315619189"],["9883","Gadget House","8801627313608"],["26573","COAL Cookware","8801973081959"],["14251","Asthma relife","8801764722855"],["5411","World Of Watches","8801768159124"],["669","Better Bliss","8801677178336"],["9145","Bouquet tales by Airin","8801787563381"],["13089","Ruhi's Craft","01636090607"],["26093","Gadgetean","8801993366949"],["12949","MyCartBD","8801969769691"],["7721","Sifat Online Shop","8801732161749"],["11635","Banggalir Oitijjo Tater Shari","8801750467091"],["24167","Diceymio","8801302756359"],["20594","SUNNAH COLLECTION","8801617054361"],["18801","Haya","8801635511128"],["29084","rublex_clothes","8801639220592"],["21258","steprova","8801349277390"],["14527","AF Mart BD","8801758535756"],["28721","Crockerise Shop  Bd","8801902859397"],["8748","Naturemix","8801720866187"],["27974","Mac'S group & co","8801894099658"],["27755","Smell hub","8801318933774"],["27667","Kingdom of Dessert","8801580972469"],["27590","Experto ReWell","8801778972910"],["27914","New Crop Top","8801734549568"],["28375","Ripple Perfumery","8801886897855"],["28487","sanacroshays","8801944961980"],["28514","haatkotha","8801976355862"],["28700","FAYSAL TELECOM","8801904404676"],["28731","Handmade Journey","8801888020103"],["28738","HealthDrop","8801785735683"],["28982","Classics - Simple But Solid","8801613960821"],["29025","অঙ্গনাঙ্গন","8801798598277"],["29160","অনলাইন শপ","8801793205743"],["29271","Merchant","8801531991109"],["29462","পিঠা পুরাণ","8801618842167"],["29693","online Shop58","8801306585850"],["29757","ATBH SHOPPERS","8801811145764"],["29782","Ridoy990","8801568573211"],["29787","Beauty vibe","8801872182575"],["29838","The Asmistry","8801863406558"],["29892","AuraVio","8801632210089"],["29919","JERSEVO","8801859988175"],["30091","Zyrah Fashion Store","8801345561426"],["30333","natural care","8801758007247"],["30362","imran","8801743151414"],["30572","অথেনটিক শপার","8801682903554"],["30589","Ladies Bag and Accosories","8801307167181"],["30591","নুরানি হালাল ঘর","8801749764838"],["30595","Miles of styles","8801897996413"],["30621","Rawan Nur","8801717778167"],["30632","Malaysia shop","8801936165759"],["30648","JS Craft","8801326122302"],["30707","Outfits by Moni","8801771938940"],["30767","Richman","8801633003713"],["25694","Rewron BD","8801853966423"],["27910","Aura Stride","8801949155155"],["19353","Platinum Moto Care","8801970406425"],["24763","Glowink","8801687007704"],["27482","Elora Gems 1","8801882189189"],["11592","Fair India Mecical","8801758096646"],["7563","Blue berry","8801854094623"],["25274","Online Bazar","8801349325080"],["7126","TS Beauty Glow","8801771261818"],["7698","Safe way","8801835839754"],["8794","Zuberee.com","8801674717356"],["1925","Ador-আদর","8801752840306"],["12454","Fahim Fragrance","8801407971045"],["24079","গঞ্জের হাট","8801605676219"],["3917","Aesthetic Shop ( cutie essentials)","8801627576394"],["21976","MumLyn.com","8801760303267"],["24117","7 Bangladesh","8801930004009"],["26181","pasheasi.com","8801340115586"],["26607","Private Care BD","8801865726591"],["21914","Gadget Store","8801410914507"],["26786","sotota medicin","8801344733504"],["17541","Ashtok :অষ্টক","8801648051594"],["13404","Momin pharmacy","8801712518044"],["15139","Orju","8801572948224"],["21874","Zepz","8801405790954"],["15564","Afnan shopping bd","8801611721634"],["18303","BK Asad Point","8801965642665"],["18091","EZHAN","8801951108096"],["2536","Tsaiko Labs","8801720442144"],["25849","dook","8801981465955"],["9171","Dina's Craft","8801842381867"],["16582","ZR Collection","8801919036878"],["25000","Tasnim Aurthy","8801776035023"],["23292","Gadget Mine","8801612933361"],["5013","Online Park","8801854432212"],["20925","Beauty Shop","8801892539255"],["28647","EVER ESSENCE","8801715515153"],["824","Trendy Belle","8801681467141"],["28309","Glimmeria","8801349829416"],["28133","Spoiler Alert","8801521306837"],["27996","Online Bd shop","8801706983922"],["27986","Thrift Closet BD","8801780649917"],["27804","Qvaly.BD","8801885007158"],["27670","LikeyShop","8801916370205"],["27604","Akhi Collection","8801780942055"],["28570","Lumiere","8801710032858"],["28686","Amader lokkho","8801906347908"],["28709","পাইকারি বাজার","8801611638727"],["28742","KiddyNova","8801915891478"],["28958","NJ Gadget house","8801626479121"],["29242","মা বাবা হোমিও হাউস","8801302037814"],["29305","Nasreen Collection","8801410658135"],["29495","Ektu Alada","8801913126731"],["29511","kings aroma","8801315410287"],["29577","Glamour n Glossy","8801905287568"],["29688","goodlifebd247.com","8801714018448"],["29991","Rio","8801616849507"],["30132","বই ঘর","8801909125022"],["30216","Anila's Craft space","8801752424036"],["30250","RT BATTERY","8801821639590"],["30293","Ratul Group Limited","8801939142493"],["30308","Solvyn","8801570273144"],["30313","Tech Veltro","8801830222121"],["30340","Billo Bazar","8801738702055"],["30345","Bir online","8801853255343"],["30347","Inaya collections","8801307547807"],["30404","Tea Voyage","8801346068603"],["30556","S M Bazar","8801772384652"],["30634","blaznate2","8801834198853"],["30657","নকশি কাঁথা","8801402538237"],["30673","SK TCG","8801604532166"],["30689","Sourov Digital shol","8801791684603"],["30704","Zlveen","8801876548317"],["30745","Daisy Twinkle","8801969863598"],["30746","Jareefah Fancy corner","8801521376394"],["27772","Ramani Fashion","8801811841821"],["30237","The Coffee Draft","8801945036949"],["30248","eliora.bd","8801979046910"],["27455","Jhotpot Solutions","8801829143731"],["29743","Evergreen Care BD","8801577345567"],["30800","Aaroshi Enterprise","8801838374717"],["30854","Style Squad","8801703076451"],["30974","tecbazarbd","8801857006209"],["30981","Md Masud","8801352480052"],["30999","natural mela","8801603284797"],["31094","SB Gallery","8801784944126"],["31106","Choice BD Bangla","8801349872548"],["31142","Shikdar Luxury","8801643250052"],["30857","আশা বিডি অনলাইন","8801748017753"],["31355","MergeIn","8801707614403"],["31381","Cozy Home","8801400100292"],["31442","Venaura","8801840116857"],["31457","KR organic BD","8801846897133"],["31542","Ruevia","8801903534515"],["31566","The trendy depot","8801710531319"],["31571","Knowledge Hunter","8801790217914"],["31599","Silver Peripherals","8801817516097"],["31695","Zevrial","8801751156833"],["31718","Anonna &Co","8801951409476"],["31727","zellonii","8801847358463"],["31768","বিচিত্রা","8801966445492"],["31780","Choicely","8801970648057"],["31683","Mithela's creation","8801796508032"],["31764","PRIMEFASHION","8801627976343"],["31855","Pahari ponner samahar","8801611996893"],["31866","White Rose fashion & style","8801706316709"],["31984","Best Fast Medical Service","8801601340556"],["31393","Nobogear","8801612626172"],["31453","Disha Eye Care","8801716236999"],["31607","SAHR","8801580647486"],["31868","organic Food Zone","8801623386699"],["32013","jayan's mamma","8801410317244"],["32033","books","8801615863975"],["32178","Moone Studio","8801973193908"],["32180","Farhana exclusives by nupur","8801640566308"],["32369","box","8801334435201"],["32380","Luxy Jewels","8801314486321"],["32389","The Pocket Gem","8801882038272"],["31382","Mystery Box","8801860771598"],["32020","Alobati.co","8801611585481"],["32066","Boys Gift Shop","8801627572881"],["23214","Biggan Bits","8801304416246"],["23832","online shipping bd","8801893472829"],["30959","Crochet By Roza","8801829079172"],["32031","golwfinit","8801935339812"],["32433","Aquaesthetic","8801943910039"],["32505","manfa","8801580717942"],["32531","HDC Homoeo hospital","8801950066680"],["32553","Sonali Uthon","8801778741529"],["32669","Shakin Mobile Relife","8801614546529"],["32707","RupKotha","8801863159517"],["32724","Style With Faith","8801877307480"],["32748","Her Vibe","8801603577471"],["32833","Zikrahmart","8801919908618"],["32840","sitara collection","8801747241487"],["32862","Bunon Fashion House","8801405703371"],["32914","Chattola Clothing","8801882459828"],["32920","Aurelia's Core","8801876982583"],["32989","পোষাক পয়েন্ট","8801743688929"],["33024","Celestia Blushè","8801714202090"],["33061","duashopbd","8801911035204"],["33129","rock star","8801581571421"],["33239","Hennalogy","8801646790113"],["31455","Leyora","8801779351658"],["31586","GlowBerry","8801405368348"],["31800","SORFAA","8801870006360"],["32410","Inkify BD","8801972009192"],["32767","খোশখেয়াল","8801746418343"],["32897","Z&S Baby Boutique","8801681496109"],["32909","Arotcitymart","8801353221593"],["32974","MTR GLOBAL","8801346353407"],["32987","পন্যঘর","8801704242713"],["33037","চুড়িওয়ালি","8801848368431"],["33159","Afrin Fashion","8801760363322"],["32760","FT Smart Shop","8801540512971"],["31872","Ahanafthreebpicc","8801922352966"],["32296","SS BLOOM","8801795778789"],["32414","Your Fabric","8801628805883"],["33186","Zunkies","8801686520207"],["33390","AID SHOP","8801991277907"],["33391","MOLLA","8801341003489"],["33394","Zynox Bd","8801979697166"],["33398","Xerqo","8801704752262"],["33402","SheShine","8801897293613"],["33413","Herbia","8801788331555"],["33434","BunBae.plush","8801984198137"],["33460","Thailand shop","8801902005373"],["33463","Closet by Sraboni","8801834079256"],["33483","Taqdeer sports","8801646504602"],["33507","Fariya","8801329987088"],["33545","Photoobie","8801628033201"],["33567","miniature shop BD","8801718539574"],["33568","Kinboki","8801352374242"],["33570","Sheed","8801352119990"],["33602","fashion point","8801984732882"],["33606","S.B Corporation","8801866277812"],["33620","Blessiva Naturals","8801537461293"],["33622","100% Original","8801751916875"],["33632","All For One","8801971402386"],["33650","Glow o’clock by Mahi","8801976632533"],["33656","The Trendy Edit By Aporna","8801310551032"],["33669","বনলতা-Bonolota","8801792597391"],["33675","Center Point","8801878724181"],["33693","Mohammad","8801316387152"],["31007","বাইক বন্ধু","8801604147793"],["33558","Khidmah Daoya Center","8801636068299"],["33643","Sunflower knots","8801767678051"],["33688","Masud  natori premium food","8801761458021"],["33799","বই বাড়ি","8801325954374"],["33815","Sumiya's dessert world","8801608086308"],["32945","Creaxis Medical Systems","8801317187438"],["33818","MAD SCENT","8801760781918"],["33848","For You","8801993297180"],["32943","Safe For Life","8801724537913"],["33179","Insha shop","8801963700324"],["31377","Al-amanah store","8801976124855"],["31733","Pet Bazar","8801968016079"],["33829","Barakah Dry Fruits","8801866682389"],["33866","Online Business","8801701794119"],["33886","EcomWave","8801643303768"],["33910","Niyamah Lifestyle","8801762133130"],["33953","সতর-satr","8801679175575"],["31171","Shariyar's Fabrics","8801614415229"],["33758","Alfi Rahman","8801920515473"],["33433","Saimon Ahmed","8801307128445"],["33835","নকশীআচার","8801825150639"],["33843","Amaya Food and Beverage Ltd","8801895602296"],["31435","Sunnah Collection Court Bazar","8801614353536"],["32386","Mim's Dream Book","8801636477792"],["33038","নৈশন্য - NAYSHONNO","8801826545345"],["33952","sumona's canvas","8801679882747"],["34012","House Need","8801877632303"],["32154","HerLuxe BD","8801602629363"],["33980","Sync","8801984241104"],["31508","ALL STAR","8801978533099"],["32532","Arshu","8801314907890"],["32874","carry charm","8801916397078"],["33887","Blush & Beauty With Sumu","8801629571726"],["34119","bhola online shopping","8801820977484"],["34134","HR Shop","8801301842202"],["31133","HappyMuse","8801612215510"],["31921","Ad'ha","8801521400220"],["33086","SI Fashion","8801356645665"],["33421","Arshia's shop","8801300034230"],["33849","AvirasbyA","8801842099904"],["33933","Tamanna's Collection","8801735951932"],["34074","Tyncluded","8801703291314"],["34084","Hridoy","8801929192128"],["28144","Clothing","8801718794137"],["30549","KHAN BAY INTERNATIONAL","8801836132870"],["34256","shalman shop","8801346648088"],["34341","Jony Saree","8801636278491"],["34348","mh tread Corporation","8801816695903"],["34358","M/S Alif automobiles","8801819821840"],["30735","Asmisha Collection","8801822081025"],["33396","ALAMINO","8801638795144"],["27771","রঙিন ছোঁয়া","8801971879323"],["29181","alifas_crochet_atelier","8801871650856"],["29296","Gangchilmart","8801711076144"],["29895","Corestyle BD","8801741384258"],["30492","Moodbox","8801314140224"],["34395","Mostafa Agro Farm","8801825467961"],["34401","INARA Candles amd cemora","8801876622761"],["34299","STYLO FASHION","8801303542653"],["34016","Continental Fragrance","8801327119550"],["31968","Daily Hub","8801881108703"],["32263","Sp fashion house","8801773950792"],["34034","Shafat's Shop","8801616384114"],["34048","korean Global House","8801633323360"],["30838","N R FASHION","8801839033968"],["33627","Tiraz","8801755913173"],["34197","Prime Choice","8801738665315"],["34564","Clothing","8801608863250"]];   // [[id, name, phone], ...]

  var CFG = {
    // AR Baby Cloud measured 262 lifetime orders: pages of 100 were honoured
    // (100 + 100 + 62), and limit=500 returned all 262 in a single request.
    // So 500 keeps the sweep to one call per merchant with no extra cost.
    limit: 500,        // rows per request
    delayMs: 120,      // pause between businesses; raise if Hive rate-limits
    pageDelayMs: 100,  // pause between pages of the same business
    maxPages: 20,      // 20 x 500 = 10,000 orders; beyond that the row is left blank
    stopAfter: 0       // 0 = all; set e.g. 5 to trial-run
  };

  /* ---------------- pure helpers (tested in node) ---------------- */

  function digits(v) { return String(v == null ? "" : v).replace(/\D/g, ""); }

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v).replace(/,/g, "").replace(/[^\d.\-]/g, "");
    if (!s || s === "-" || s === ".") return null;
    var f = parseFloat(s);
    return isFinite(f) ? f : null;
  }

  /* Next.js flight: plain "2a:{...}" lines and inline self.__next_f.push([1,"2a:{...}"]) */
  function extractFlight(text) {
    var out = [], seen = new Set();
    function walk(node, depth) {
      if (!node || depth > 10 || typeof node !== "object") return;
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth + 1); }); return; }
      out.push(node);
      Object.keys(node).forEach(function (k) { walk(node[k], depth + 1); });
    }
    function parseChunk(raw) {
      var s = String(raw).trim();
      if (!s) return null;
      if (s.charAt(0) === "{" || s.charAt(0) === "[") {
        try { return JSON.parse(s); } catch (e) { return null; }
      }
      return null;
    }
    // matchAll only: an exec() loop is one stray /g literal away from hanging.
    for (var m of text.matchAll(/self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g)) {
      var inner;
      try { inner = JSON.parse(m[1]); } catch (e) { continue; }
      inner.split("\n").forEach(function (line) {
        var v = parseChunk(line.replace(/^[0-9a-fA-F]+:/, ""));
        if (v) walk(v, 0);
      });
    }
    text.split("\n").forEach(function (line) {
      var v = parseChunk(line.replace(/^[0-9a-fA-F]+:/, "").replace(/^\$/, ""));
      if (v) walk(v, 0);
    });
    return out;
  }

  var DATE_KEYS = ["createdAt", "created_at", "orderDate", "order_date", "date", "placedAt",
                   "placed_at", "orderCreatedAt", "created", "timestamp", "deliveryDate"];
  var TOTAL_KEYS = ["total", "totalCount", "total_count", "totalOrders", "total_orders",
                    "count", "resultCount", "totalResults", "totalItems", "recordsTotal"];
  var BIZ_PHONE_KEYS = ["businessPhone", "business_phone", "shopPhone", "merchantPhone", "phone"];

  function dateOf(o) {
    for (var i = 0; i < DATE_KEYS.length; i++) {
      var v = o[DATE_KEYS[i]];
      if (typeof v === "string" || typeof v === "number") {
        var d = new Date(v);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
    }
    return null;
  }

  function orderLike(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    var hasDate = !!dateOf(o);
    var hasId = ["consignmentId", "consignment_id", "consignmentID", "orderId", "order_id",
                 "_id", "id", "trackingId", "merchantOrderId"].some(function (k) {
                   return o[k] !== undefined && typeof o[k] !== "object";
                 });
    return hasDate && hasId;
  }

  /** Pull order records, a reported total, and business phones out of a response. */
  function parseOrders(text) {
    var objects;
    try { objects = [JSON.parse(text)]; } catch (e) { objects = extractFlight(text); }

    var orders = [], totals = [], bizPhones = {}, listLike = false;
    objects.forEach(function (o) {
      if (!o || typeof o !== "object") return;
      ["orders", "data", "rows", "results", "items", "list"].forEach(function (k) {
        if (Array.isArray(o[k])) listLike = true;
      });
      if (orderLike(o)) {
        orders.push(o);
        BIZ_PHONE_KEYS.forEach(function (k) {
          if (o[k] !== undefined && typeof o[k] !== "object") {
            var d = digits(o[k]);
            if (d.length >= 10) bizPhones[d.slice(-10)] = 1;
          }
        });
        ["business", "businessInfo", "shop", "merchant"].forEach(function (k) {
          if (o[k] && typeof o[k] === "object" && o[k].phone) {
            var d2 = digits(o[k].phone);
            if (d2.length >= 10) bizPhones[d2.slice(-10)] = 1;
          }
        });
      }
      TOTAL_KEYS.forEach(function (k) {
        var v = o[k];
        if (typeof v === "number" && v >= 0 && v < 1e9) totals.push(v);
      });
    });

    // de-dupe order records (flight repeats objects across chunks)
    var byKey = {}, uniq = [];
    orders.forEach(function (o) {
      var key = [o.consignmentId, o.consignment_id, o.orderId, o._id, o.id, dateOf(o)]
        .filter(function (x) { return x !== undefined && x !== null; })
        .map(String).join("|");
      if (!byKey[key]) { byKey[key] = 1; uniq.push(o); }
    });

    var dates = uniq.map(dateOf).filter(Boolean).sort();
    var total = totals.length ? Math.max.apply(null, totals) : null;
    var ids = uniq.map(function (o) {
      return String(o.consignmentId || o.consignment_id || o.orderId || o.order_id ||
                    o._id || o.id || o.trackingId || dateOf(o) || "");
    }).filter(Boolean);

    if (totals.length) listLike = true;
    return { orders: uniq.length, rows: uniq.length, dates: dates, ids: ids,
             total: total, listLike: listLike, bizPhones: Object.keys(bizPhones) };
  }

  /**
   * count      : true lifetime order count (from meta.total when present)
   * complete   : true when we actually saw every order row, so distinct-day
   *              counting is trustworthy. Otherwise only first/last are used.
   */
  function summarise(dates, count, complete) {
    dates = (dates || []).slice().sort();
    var distinct = {};
    dates.forEach(function (d) { distinct[d] = 1; });
    var first = dates.length ? dates[0] : "";
    var last = dates.length ? dates[dates.length - 1] : "";
    var span = 0;
    if (first && last) {
      span = Math.round((new Date(last) - new Date(first)) / 86400000) + 1;
    }
    return {
      orders: count == null ? null : count,
      first: first,
      last: last,
      distinctDays: complete ? Object.keys(distinct).length : 0,
      spanDays: span,
      complete: !!complete
    };
  }

  /* ---------------- browser plumbing ---------------- */

  if (typeof window === "undefined") {
    // node test harness
    module.exports = { extractFlight: extractFlight, parseOrders: parseOrders,
                       summarise: summarise, digits: digits, num: num };
    return;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function get(params) {
    var url = new URL("/orders?" + new URLSearchParams(params).toString(), location.origin).toString();
    var variants = [
      { RSC: "1", Accept: "text/x-component" },
      { Accept: "application/json" },
      { Accept: "text/html" }
    ];
    for (var i = 0; i < variants.length; i++) {
      try {
        var res = await fetch(url, { credentials: "include", headers: variants[i] });
        if (res.status === 429) { await sleep(3000); continue; }   // rate limited
        if (!res.ok) continue;
        var text = await res.text();
        var parsed = parseOrders(text);
        if (parsed.orders > 0 || parsed.total != null) return { ok: true, text: text, parsed: parsed };
        if (i === variants.length - 1) return { ok: true, text: text, parsed: parsed };
      } catch (e) { /* next variant */ }
    }
    return { ok: false, text: "", parsed: { orders: 0, dates: [], total: null, bizPhones: [] } };
  }

  function phoneParamVariants(phone) {
    return [
      { businessPhone: phone }, { phone: phone }, { business_phone: phone },
      { businessNumber: phone }, { mobile: phone }
    ];
  }

  async function control() {
    console.log("%cControl check — a nonsense phone must return 0 orders", "color:#2563EB;font-weight:bold");
    var r = await get(Object.assign({ page: "1", limit: "10" }, { businessPhone: "8800000000000" }));
    var n = r.parsed.total != null ? r.parsed.total : r.parsed.orders;
    if (n !== 0) {
      console.warn("CONTROL FAILED: nonsense phone returned " + n + " orders.");
      console.warn("That means the filter is ignored (or the route needs a different param),");
      console.warn("so every business would get the same total. Stopping.");
      console.log("First 1200 chars of that response — send this over:");
      console.log(r.text.slice(0, 1200));
      return false;
    }
    console.log("%cControl passed (0 orders for junk phone)", "color:#0E9F6E");
    return true;
  }

  var results = {};
  var chosenVariant = null;   // learned from the first business that answers

  async function queryBusiness(b) {
    var phone = digits(b[2]);
    var attempts = phoneParamVariants(phone);
    if (chosenVariant) {
      attempts.sort(function (x) { return Object.keys(x)[0] === chosenVariant ? -1 : 1; });
    }

    for (var i = 0; i < attempts.length; i++) {
      var base = attempts[i];
      var variant = Object.keys(base)[0];

      var first = await get(Object.assign({ page: "1", limit: String(CFG.limit) }, base));
      if (!first.ok) continue;

      var sawPhone = phone.length >= 10 && first.text.indexOf(phone.slice(-10)) !== -1;
      // Zero orders is a legitimate answer once the response is recognisably an
      // order list; only a shapeless body means we guessed the wrong param name.
      if (!sawPhone && first.parsed.orders === 0 && first.parsed.total == null &&
          !first.parsed.listLike) continue;

      chosenVariant = variant;

      // Walk every page until one comes back short. The count is the number of
      // DISTINCT order ids seen — never the page size, which is what produced
      // a wall of fake "100 orders" on the first run.
      var seen = {}, daysSeen = {}, count = 0, page = 1, complete = false, bad = false;
      var cur = first, pages = 0;

      while (page <= CFG.maxPages) {
        var p = cur.parsed;
        var added = 0;
        (p.ids || []).forEach(function (id) {
          if (!seen[id]) { seen[id] = 1; count++; added++; }
        });
        (p.dates || []).forEach(function (d) { daysSeen[d] = 1; });
        pages++;

        if (p.rows < CFG.limit) { complete = true; break; }     // short page = last page
        if (page >= CFG.maxPages) break;                        // hit the cap -> unknown
        page++;

        var next = await get(Object.assign({ page: String(page), limit: String(CFG.limit) }, base));
        if (!next.ok) { bad = true; break; }
        if (page > 2) {                                          // no forward progress
          var fresh = (next.parsed.ids || []).filter(function (id) { return !seen[id]; }).length;
          if (fresh === 0) { bad = true; break; }
        }
        cur = next;
        await sleep(CFG.pageDelayMs);
      }

      var dateList = Object.keys(daysSeen).sort();
      var s = {
        orders: (complete && !bad) ? count : null,   // null => write blank, never lie
        first: (complete && !bad) ? (dateList[0] || "") : "",
        last: (complete && !bad) ? (dateList[dateList.length - 1] || "") : "",
        distinctDays: (complete && !bad) ? dateList.length : 0,
        spanDays: 0,
        complete: complete && !bad,
        pages: pages,
        seen: count,
        phoneMatched: sawPhone,
        variant: variant
      };
      if (s.first && s.last) {
        s.spanDays = Math.round((new Date(s.last) - new Date(s.first)) / 86400000) + 1;
      }
      return s;
    }

    return { orders: null, first: "", last: "", distinctDays: 0, spanDays: 0, complete: false,
             pages: 0, seen: 0, phoneMatched: false, variant: null, failed: true };
  }

  function saveCsv(csv) {
    try {
      var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "hive_orders_" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      console.log("%cSaved to your Downloads folder", "color:#0E9F6E");
      return true;
    } catch (e) {
      console.warn("Could not save the file:", e.message);
      return false;
    }
  }

  function toCsv(rows) {
    var esc = function (v) {
      v = v == null ? "" : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var head = ["Business ID", "Business Name", "Phone", "Total Orders",
                "First Order Date", "Last Order Date", "Distinct Order Days"];
    return [head.join(",")].concat(rows.map(function (r) {
      return [r.id, r.name, r.phone, r.orders, r.first, r.last, r.distinctDays].map(esc).join(",");
    })).join("\r\n");
  }

  async function run() {
    if (!(await control())) return;
    var rows = [], failed = [], t0 = Date.now();
    var list = CFG.stopAfter ? BUSINESSES.slice(0, CFG.stopAfter) : BUSINESSES;

    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var s = await queryBusiness(b);
      var row = { id: b[0], name: b[1], phone: b[2], orders: s.orders, first: s.first,
                  last: s.last, distinctDays: s.distinctDays, spanDays: s.spanDays };
      rows.push(row);
      if (s.failed || !s.phoneMatched) failed.push(row);
      if ((i + 1) % 10 === 0 || i === list.length - 1) {
        var rate = (i + 1) / ((Date.now() - t0) / 1000);
        console.log((i + 1) + "/" + list.length + "  " + b[1] + " → " +
          (s.orders == null ? "?" : s.orders) + " orders, " +
          (s.spanDays || "?") + "d span  (" + rate.toFixed(1) + "/s)");
      }
      await sleep(CFG.delayMs);
    }

    window.__hiveRows = rows;
    window.__hiveCsv = toCsv(rows);
    var ok = rows.filter(function (r) { return r.orders != null; }).length;
    var withOrders = rows.filter(function (r) { return r.orders > 0; }).length;
    var withDates = rows.filter(function (r) { return r.first; }).length;

    console.log("%cDONE — " + ok + "/" + rows.length + " businesses with a total, " +
      withOrders + " with >0 orders, " + withDates + " with dates",
      "color:#0E9F6E;font-weight:bold");
    if (failed.length) {
      console.warn(failed.length + " business(es) did not match the filter — first few:");
      console.table(failed.slice(0, 8));
    }
    console.log("Working query param: " + (chosenVariant || "(none found)"));
    console.log(window.__hiveCsv.split("\r\n").slice(0, 6).join("\n") + "\n…");
    saveCsv(window.__hiveCsv);
    try { await navigator.clipboard.writeText(window.__hiveCsv); console.log("CSV also copied to clipboard"); }
    catch (e) { console.log("Clipboard blocked — the file download above still works"); }
  }

  window.hiveOrders = { run: run, control: control, results: results, query: queryBusiness,
                        save: function () {
                          if (!window.__hiveCsv) { console.warn("Run hiveOrders.run() first"); return; }
                          if (!saveCsv(window.__hiveCsv)) console.log("Run: copy(window.__hiveCsv)");
                        },
                        probe: function (name) {
                          var b = BUSINESSES.filter(function (x) { return (x[1] || "").toLowerCase().indexOf(String(name).toLowerCase()) !== -1; })[0];
                          if (!b) { console.warn("No business matching " + name); return; }
                          return queryBusiness(b).then(function (s) {
                            console.log("probe:", b[0], b[1], JSON.stringify(s));
                            return s;
                          });
                        } };

  console.log("%cHive orders puller loaded", "color:#2563EB;font-weight:bold");
  console.log("Run:  await hiveOrders.run()        — all " + BUSINESSES.length + " businesses");
  console.log("Try:  await hiveOrders.probe(\"Watch Hub\")  — single business first");
})();
