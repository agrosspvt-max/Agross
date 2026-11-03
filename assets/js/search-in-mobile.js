const searchInput1 = document.getElementById('search-input1');
const autocomplete1 = document.getElementById('autocomplete1');

const products1 = [
    // chemical product starts 
    { id: 'maxx eleven', name: 'MAXX ELEVEN', icon: 'products/Maxx Eleven.png', url: 'product.html?productId=maxx eleven' },
    { id: 'shoot out', name: 'SHOOT OUT',  icon: 'products/Shoot Out.png', url: 'product.html?productId=shoot out' },
    { id: 'tejas', name: 'TEJAS',  icon: 'products/Tejas.png', url: 'product.html?productId=tejas' },
    { id: 'super play', name: 'SUPER PLAY',  icon: 'products/Super Play.png', url: 'product.html?productId=super play' },
    { id: 'taandab', name: 'TAANBAD',  icon: 'products/Taandab.png', url: 'product.html?productId=taandab' },
    { id: 'hercules', name: 'HERCULES',  icon: 'products/Hercules.png', url: 'product.html?productId=hercules' },
    { id: 'chima', name: 'CHIMA',  icon: 'products/Chima.png', url: 'product.html?productId=chima' },
    { id: 'king maker', name: 'KING MAKER',  icon: 'products/King Maker.png', url: 'product.html?productId=king maker' },
    { id: 'jonson', name: 'JONSON',  icon: 'products/Jonson.png', url: 'product.html?productId=jonson' },
    { id: 'jonson plus', name: 'JONSON PLUS',  icon: 'products/Jonson Plus.png', url: 'product.html?productId=jonson plus' },
    { id: 'curiass', name: 'CURIASS',  icon: 'products/Cuirass.png', url: 'product.html?productId=cuirass' },
    { id: 'fox plus', name: 'FOX PLUS',  icon: 'products/Fox Plus.png', url: 'product.html?productId=fox plus' },
    { id: 'protection', name: 'PROTECTION',  icon: 'products/Protection.png', url: 'product.html?productId=protection' },
    { id: 'damage', name: 'DAMAGE',  icon: 'products/Damage.png', url: 'product.html?productId=damage' },
    { id: 'maxx zyme', name: 'MAXX ZYME',  icon: 'products/Maxx Zyme.png', url: 'product.html?productId=maxx zyme' },
    { id: 'cut out', name: 'CUT OUT',  icon: 'products/Cut Out.png', url: 'product.html?productId=cut out' },
    { id: 'maxx selieno', name: 'MAXX SELIENO',  icon: 'products/Maxx Selieno.png', url: 'product.html?productId=maxx selieno' },
    { id: 'sanga super', name: 'SANGA SUPER',  icon: 'products/Sanga Super.png', url: 'product.html?productId=sanga super' },
    { id: 'shooter', name: 'SHOOTER',  icon: 'products/SHooter.png', url: 'product.html?productId=shooter' },
    { id: 'maxx cure', name: 'MAXX CURE',  icon: 'products/Maxx Cure.png', url: 'product.html?productId=maxx cure' },
    { id: 'shield', name: 'SHIELD',  icon: 'products/Shield.png', url: 'product.html?productId=shield' },
    { id: 'warrior', name: 'WARRIOR',  icon: 'products/Warrior.png', url: 'product.html?productId=warrior' },
    { id: 'monomaxx', name: 'MONOMAXX',  icon: 'products/Monomaxx.png', url: 'product.html?productId=monomaxx' },
    { id: 'tattoo', name: 'TATTOO',  icon: 'products/Tattoo.png', url: 'product.html?productId=tattoo' },
    { id: 'manager', name: 'MANAGER',  icon: 'products/Manager.png', url: 'product.html?productId=manager' },
    { id: 'magnet', name: 'MAGNET',  icon: 'products/Magnet.png', url: 'product.html?productId=magnet' },
    { id: 'waris', name: 'WARIS',  icon: 'products/Waris.png', url: 'product.html?productId=waris' },
    { id: 'dolo', name: 'DOLO',  icon: 'products/Dolo.png', url: 'product.html?productId=dolo' },
    { id: 'poras', name: 'PORAS',  icon: 'products/Poras.png', url: 'product.html?productId=poras' },
    { id: 'pride', name: 'PRIDE',  icon: 'products/Pride.png', url: 'product.html?productId=pride' },
    { id: 'captain', name: 'CAPTAIN',  icon: 'products/Captain.png', url: 'product.html?productId=captain' },
    { id: 'maxx iso', name: 'MAXX ISO',  icon: 'products/Maxx ISO.png', url: 'product.html?productId=maxx iso' },
    { id: 'hacker', name: 'HACKER',  icon: 'products/Hacker.png', url: 'product.html?productId=hacker' },
    { id: 'maxx 32', name: 'MAXX 32',  icon: 'products/Maxx 32.png', url: 'product.html?productId=maxx 32' },
    { id: 'maxx grip', name: 'MAXX GRIP',  icon: 'products/Maxx Grip.png', url: 'product.html?productId=maxx grip' },
    { id: 'maxx 71', name: 'MAXX 71',  icon: 'products/Maxx 71.png', url: 'product.html?productId=maxx 71' },
    { id: 'max mad', name: 'MAX MAD',  icon: 'products/Max Mad.png', url: 'product.html?productId=max mad' },
    { id: 'neon', name: 'NEON',  icon: 'products/Neon.png', url: 'product.html?productId=neon' },
    { id: 'glymo', name: 'GLYMO',  icon: 'products/Glymo.png', url: 'product.html?productId=glymo' },
    { id: 'max zin', name: 'MAX ZIN',  icon: 'products/Max Zin.png', url: 'product.html?productId=max zin' },
    { id: 'coding', name: 'CODING',  icon: 'products/Coding.png', url: 'product.html?productId=coding' },
    { id: 'sirsum', name: 'SIRSUM',  icon: 'products/Sirsum.png', url: 'product.html?productId=sirsum' },
    { id: 'mycin', name: 'MYCIN',  icon: 'products/Mycin.png', url: 'product.html?productId=mycin' },
    { id: 'zilmil', name: 'ZILMIL',  icon: 'products/Zilmil.png', url: 'product.html?productId=zilmil' },
    { id: 'janta', name: 'JANTA',  icon: 'products/Janta.png', url: 'product.html?productId=janta' },
    { id: 'boro c', name: 'BORO C',  icon: 'products/Boro C.png', url: 'product.html?productId=boro c' },
    { id: 'everest 50', name: 'EVEREST 50',  icon: 'products/Everest 50.png', url: 'product.html?productId=everest 50' },
    { id: 'everest 52', name: 'EVEREST 52',  icon: 'products/Everest 52.png', url: 'product.html?productId=everest 52' },
    { id: 'everest 19', name: 'EVEREST 19',  icon: 'products/Everest 19.png', url: 'product.html?productId=everest 19' },
    { id: 'mixx c', name: 'MIXX C',  icon: 'products/Mixx C.png', url: 'product.html?productId=mixx c' },
    { id: 'fero c', name: 'FERO C',  icon: 'products/Fero C.png', url: 'product.html?productId=fero c' },
    { id: 'everest cn', name: 'EVEREST CN',  icon: 'products/Everest CN.png', url: 'product.html?productId=everest cn' },
    { id: 'maxx power', name: 'MAXX POWER',  icon: 'products/Maxx Power.png', url: 'product.html?productId=maxx power' },
    { id: 'camasa', name: 'CASAMA',  icon: 'products/Camasa.png', url: 'product.html?productId=camasa' },
    { id: 'mint', name: 'MINT',  icon: 'products/Mint.png', url: 'product.html?productId=mint' },
    { id: 'zingo', name: 'ZINGO',  icon: 'products/Zingo.png', url: 'product.html?productId=zingo' },
    { id: 'black cat', name: 'BLACK CAT',  icon: 'products/Black Cat.png', url: 'product.html?productId=black cat' },
    { id: 'agora', name: 'AGORA',  icon: 'products/Agora.png', url: 'product.html?productId=agora' },
    { id: 'nuclear', name: 'NUCLEAR',  icon: 'products/Nuclear.png', url: 'product.html?productId=nuclear' },
    { id: 'viper', name: 'VIPER',  icon: 'products/Viper.png', url: 'product.html?productId=viper' },
    { id: 'weapon', name: 'WEAPON',  icon: 'products/Weapon.png', url: 'product.html?productId=weapon' },
    { id: 'kaalkey', name: 'KAALKEY',  icon: 'products/Kaalkey.png', url: 'product.html?productId=kaalkey' },
    { id: 'vatoka', name: 'VATOKA',  icon: 'products/Vatoka.png', url: 'product.html?productId=vatoka' },
    { id: 'maxlone', name: 'MAXLONE',  icon: 'products/Maxlone.png', url: 'product.html?productId=maxlone' },
    { id: 'minister', name: 'MINISTER',  icon: 'products/Minister.png', url: 'product.html?productId=minister' },
    
    // nonchemical products starts
    { id: 'maxx prom', name: 'MAXX PROM',  icon: 'products/Maxx Prom.png', url: 'nonchemical-details.html?productId=maxx prom' },
    { id: 'pretej', name: 'PRETEJ',  icon: 'products/Pretej.png', url: 'nonchemical-details.html?productId=pretej' },
    { id: 'veera', name: 'VEERA',  icon: 'products/Veera.png', url: 'nonchemical-details.html?productId=veera' },
    { id: 'maxx tricho', name: 'MAXX TRICHO',  icon: 'products/Maxx Tricho.png', url: 'nonchemical-details.html?productId=maxx tricho' },
    { id: 'janta gold', name: 'JANTA GOLD',  icon: 'products/Janta Gold.png', url: 'nonchemical-details.html?productId=janta gold' },
    { id: 'proceed', name: 'PROCEED',  icon: 'products/Proceed.png', url: 'nonchemical-details.html?productId=proceed' },
    { id: 'adbhut', name: 'ADBHUT',  icon: 'products/Adbhut.png', url: 'nonchemical-details.html?productId=adbhut' },
    { id: 'recover', name: 'RECOVER',  icon: 'products/Recover.png', url: 'nonchemical-details.html?productId=recover' },
    { id: 'maxx raiza', name: 'MAXX RAIZA',  icon: 'products/Maxx Raiza.png', url: 'nonchemical-details.html?productId=maxx raiza' },
    { id: 'fire', name: 'FIRE',  icon: 'products/Fire.png', url: 'nonchemical-product.html?productId=fire' },
    { id: 'rooter drip', name: 'ROOTER DRIP',  icon: 'products/Rooter Drip.png', url: 'nonchemical-details.html?productId=rooter drip' },
    { id: 'rettol', name: 'RETTOL',  icon: 'products/Rettol.png', url: 'nonchemical-details.html?productId=rettol' },
    { id: 'surgeon', name: 'SURGEON',  icon: 'products/Surgeon.png', url: 'nonchemical-details.html?productId=surgeon' },
    { id: 'ladaku', name: 'LADAKU',  icon: 'products/Ladaku.png', url: 'nonchemical-details.html?productId=ladaku' },
    { id: 'drona', name: 'DRONA',  icon: 'products/Drona.png', url: 'nonchemical-details.html?productId=drona' },
    { id: 'roman', name: 'ROMAN',  icon: 'products/Roman.png', url: 'nonchemical-details.html?productId=roman' },
    { id: 'defeat', name: 'DEFEAT',  icon: 'products/Defeat.png', url: 'nonchemical-details.html?productId=defeat' },
    { id: 'vajeer', name: 'VAJEER',  icon: 'products/Vajeer.png', url: 'nonchemical-details.html?productId=vajeer' },
    { id: 'odin', name: 'ODIN',  icon: 'products/Odin.png', url: 'nonchemical-details.html?productId=odin' },
    { id: 'panther', name: 'PANTHER',  icon: 'products/Panther.png', url: 'nonchemical-details.html?productId=panther' },
    { id: 'red bull', name: 'RED BULL',  icon: 'products/RedBull.png', url: 'nonchemical-details.html?productId=red bull' },
    { id: 'open', name: 'OPEN',  icon: 'products/Open.png', url: 'nonchemical-details.html?productId=open' },
    { id: 'arjun', name: 'ARJUN',  icon: 'products/Arjun.png', url: 'nonchemical-details.html?productId=arjun' },
    { id: 'potaxx dm', name: 'POTAXX DM',  icon: 'products/Potaxx DM.png', url: 'nonchemical-details.html?productId=potaxx dm' },
    { id: 'panda', name: 'PANDA',  icon: 'products/Panda.png', url: 'nonchemical-details.html?productId=panda' },
    { id: 'potaxx', name: 'POTAXX',  icon: 'products/Potaxx.png', url: 'nonchemical-details.html?productId=potaxx' },
    { id: 'asur', name: 'ASUR',  icon: 'products/Asur.png', url: 'nonchemical-details.html?productId=asur' },
    { id: 'maxx biana', name: 'MAXX BIANA',  icon: 'products/Maxx Biana.png', url: 'nonchemical-details.html?productId=maxx biana' },
    { id: 'coka', name: 'COKA',  icon: 'products/Coka.png', url: 'nonchemical-details.html?productId=coka' },
    { id: 'rotomaxx', name: 'ROTOMAXX',  icon: 'products/Rotomax.png', url: 'nonchemical-details.html?productId=rotomax' },
    { id: 'jamura 5gw', name: 'JAMURA 5G',  icon: 'products/Jamura 5G.png', url: 'nonchemical-details.html?productId=jamura 5g' },
    ];

searchInput1.addEventListener('input', function() {
    const searchTerm = searchInput1.value.toLowerCase();
    const matchedProducts1 = products1.filter(product => product.name.toLowerCase().includes(searchTerm));

    if (matchedProducts1.length > 0) {
        const autocomplete1Options = matchedProducts1.map(product => `
            <div class="autocomplete1-item" data-url="${product.url}">
                <img src="${product.icon}" alt="${product.name}" class="autocomplete1-icon">
                <span class="autocomplete1-name">${product.name}</span>
            </div>
        `).join('');

        autocomplete1.innerHTML = autocomplete1Options;
        autocomplete1.style.display = 'block';

        const autocomplete1Items = autocomplete1.querySelectorAll('.autocomplete1-item');
        autocomplete1Items.forEach(item => {
            item.addEventListener('click', () => {
                const url = item.getAttribute('data-url');
                window.location.href = url;
            });
        });
    } else {
        autocomplete1.innerHTML = '';
        autocomplete1.style.display = 'none';
    }
});

document.addEventListener('click', function(event) {
    const targetElement = event.target;
    if (!targetElement.closest('.search-box1')) {
        autocomplete1.innerHTML = '';
        autocomplete1.style.display = 'none';
    }
});