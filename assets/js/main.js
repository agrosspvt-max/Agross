(function($){
    "use strict";

    // Header Sticky
    var navbar = $('.navbar-area');
    var stickyHeight = navbar.offset().top;

    $(window).on('scroll', function() {
        if ($(this).scrollTop() > stickyHeight){  
            navbar.addClass("is-sticky");
        }
        else{
            navbar.removeClass("is-sticky");
        }
    });
    // Mean Menu
	$('.mean-menu').meanmenu({
		meanScreenWidth: "991"
	});

	// Feedback Swiper
    var swiper = new Swiper(".feedbackSwiper", {
        autoplay: false,
        direction: "vertical",
        navigation: {
            nextEl: ".two",
            prevEl: ".one",
        },
        breakpoints: {
            0: {
                slidesPerView: 1,
                direction: "horizontal",
            },
            576: {
                slidesPerView: 1,
                direction: "horizontal",
            },
            768: {
                slidesPerView: 2,
                spaceBetween: 25,
                direction: "horizontal",
            },
            992: {
                slidesPerView: 2,
            },
            1200: {
                slidesPerView: 2,
            },
        },
    });
	var swiper = new Swiper(".feedbackSwiperSlides", {
		loop: true,
        autoplay: false,
		spaceBetween: 30,
		centeredSlides: true,
		navigation: {
            nextEl: ".customTwo",
            prevEl: ".customOne",
        },
        breakpoints: {
            0: {
				slidesPerView: 1,
            },
            576: {
				slidesPerView: 2,
				spaceBetween: 25,
				centeredSlides: false,
            },
            768: {
				slidesPerView: 2,
            },
            992: {
				slidesPerView: 3,
            },
            1200: {
				slidesPerView: 3,
            },
            1400: {
				slidesPerView: 4,
            },
        },
    });

    // Screenshots Slides
	var swiper = new Swiper(".screenshotsSwiperSlides", {
		loop: false,
        autoplay: false,
		spaceBetween: 25,
        pagination: {
            el: ".swiper-pagination",
            clickable: true,
        },
        breakpoints: {
            0: {
				slidesPerView: 2,
            },
            576: {
				slidesPerView: 2,
            },
            768: {
				slidesPerView: 3,
            },
            992: {
				slidesPerView: 3,
            },
            1200: {
				slidesPerView: 3,
            },
            1400: {
				slidesPerView: 5,
            },
        },
    });

	// On Hover
	try {
        $(".features-area .content ul li.b2").on("mouseenter", function() {
            $('.features-area .image img:nth-child(2)').addClass('active');
        });
        $(".features-area .content ul li.b2").on("mouseleave", function() {
            $('.features-area .image img:nth-child(2)').removeClass('active');
        });
        $(".features-area .content ul li.b3").on("mouseenter", function() {
            $('.features-area .image img:nth-child(3)').addClass('active');
        });
        $(".features-area .content ul li.b3").on("mouseleave", function() {
            $('.features-area .image img:nth-child(3)').removeClass('active');
        });
    } catch (err) {}

    // Tabs
    $('.customer-service-tabs .tabs li').on('click', function(){
		var tab_id = $(this).attr('data-tab');
		$('.customer-service-tabs .tabs li').removeClass('current');
		$('.tab-content').removeClass('current');
		$(this).addClass('current');
		$("#"+tab_id).addClass('current');
	});

    // Odometer
	$('.odometer').appear(function(e) {
		var odo = $(".odometer");
		odo.each(function() {
			var countNumber = $(this).attr("data-count");
			$(this).html(countNumber);
		});
	});

    // Popup Image
	$('.popup-image').magnificPopup({
		type: 'image',
		gallery:{
			enabled:true
		}
	});

	// Popup Video
	$('.popup-video').magnificPopup({
		disableOn: 320,
		type: 'iframe',
		mainClass: 'mfp-fade',
		removalDelay: 160,
		preloader: false,
		fixedContentPos: false
	});

	// FAQ Accordion
	$(function() {
		$('.accordion').find('.accordion-title').on('click', function(){
			// Adds Active Class
			$(this).toggleClass('active');
			// Expand or Collapse This Panel
			$(this).next().slideToggle('fast');
			// Hide The Other Panels
			$('.accordion-content').not($(this).next()).slideUp('fast');
			// Removes Active Class From Other Titles
			$('.accordion-title').not($(this)).removeClass('active');		
		});
	});

	// WoW
	new WOW().init();

    // Scroll Back to Top
	try {
		let progressPath = document.querySelector('.progress-wrap path');
		let pathLength = progressPath.getTotalLength();
		progressPath.style.transition = progressPath.style.WebkitTransition = 'none';
		progressPath.style.strokeDasharray = pathLength + ' ' + pathLength;
		progressPath.style.strokeDashoffset = pathLength;
		progressPath.getBoundingClientRect();
		progressPath.style.transition = progressPath.style.WebkitTransition = 'stroke-dashoffset 10ms linear';		
        progressPath.style.strokeDasharray = '38.3137, 33.3137';
        progressPath.style.strokeDashoffset = '17.6062';
        let updateProgress = function () {
			let scroll = $(window).scrollTop();
			let height = $(document).height() - $(window).height();
			let progress = pathLength - (scroll * pathLength / height);
			progressPath.style.strokeDashoffset = progress;
		}
		updateProgress();
		$(window).on('scroll', updateProgress);	
		let offset = 50;
		let duration = 550;
		$(window).on('scroll', function() {
			if ($(this).scrollTop() > offset) {
				$('.progress-wrap').addClass('active-progress');
			} else {
				$('.progress-wrap').removeClass('active-progress');
			}
		});				
		$('.progress-wrap').on('click', function(event) {
			event.preventDefault();
			$('html, body').animate({scrollTop: 0}, duration);
			return false;
		});
	} catch (err) {}

    // Preloader
	$(window).on('load', function() {
		$('.preloader-area').addClass('deactivate');
	});

}(jQuery));


var AndraPradesh = ["Anantapur","Chittoor","East Godavari","Guntur","Kadapa","Krishna","Kurnool","Prakasam","Nellore","Srikakulam","Visakhapatnam","Vizianagaram","West Godavari"];
var ArunachalPradesh = ["Anjaw","Changlang","Dibang Valley","East Kameng","East Siang","Kra Daadi","Kurung Kumey","Lohit","Longding","Lower Dibang Valley","Lower Subansiri","Namsai","Papum Pare","Siang","Tawang","Tirap","Upper Siang","Upper Subansiri","West Kameng","West Siang","Itanagar"];
var Assam = ["Baksa","Barpeta","Biswanath","Bongaigaon","Cachar","Charaideo","Chirang","Darrang","Dhemaji","Dhubri","Dibrugarh","Goalpara","Golaghat","Hailakandi","Hojai","Jorhat","Kamrup Metropolitan","Kamrup (Rural)","Karbi Anglong","Karimganj","Kokrajhar","Lakhimpur","Majuli","Morigaon","Nagaon","Nalbari","Dima Hasao","Sivasagar","Sonitpur","South Salmara Mankachar","Tinsukia","Udalguri","West Karbi Anglong"];
var Bihar = ["Araria","Arwal","Aurangabad","Banka","Begusarai","Bhagalpur","Bhojpur","Buxar","Darbhanga","East Champaran","Gaya","Gopalganj","Jamui","Jehanabad","Kaimur","Katihar","Khagaria","Kishanganj","Lakhisarai","Madhepura","Madhubani","Munger","Muzaffarpur","Nalanda","Nawada","Patna","Purnia","Rohtas","Saharsa","Samastipur","Saran","Sheikhpura","Sheohar","Sitamarhi","Siwan","Supaul","Vaishali","West Champaran"];
var Chhattisgarh = ["Balod","Baloda Bazar","Balrampur","Bastar","Bemetara","Bijapur","Bilaspur","Dantewada","Dhamtari","Durg","Gariaband","Janjgir Champa","Jashpur","Kabirdham","Kanker","Kondagaon","Korba","Koriya","Mahasamund","Mungeli","Narayanpur","Raigarh","Raipur","Rajnandgaon","Sukma","Surajpur","Surguja"];
var Goa = ["North Goa","South Goa"];
var Gujarat = ["Ahmedabad","Amreli","Anand","Aravalli","Banaskantha","Bharuch","Bhavnagar","Botad","Chhota Udaipur","Dahod","Dang","Devbhoomi Dwarka","Gandhinagar","Gir Somnath","Jamnagar","Junagadh","Kheda","Kutch","Mahisagar","Mehsana","Morbi","Narmada","Navsari","Panchmahal","Patan","Porbandar","Rajkot","Sabarkantha","Surat","Surendranagar","Tapi","Vadodara","Valsad"];
var Haryana = ["Ambala","Bhiwani","Charkhi Dadri","Faridabad","Fatehabad","Gurugram","Hisar","Jhajjar","Jind","Kaithal","Karnal","Kurukshetra","Mahendragarh","Mewat","Palwal","Panchkula","Panipat","Rewari","Rohtak","Sirsa","Sonipat","Yamunanagar"];
var HimachalPradesh = ["Bilaspur","Chamba","Hamirpur","Kangra","Kinnaur","Kullu","Lahaul Spiti","Mandi","Shimla","Sirmaur","Solan","Una"];
var JammuKashmir = ["Anantnag","Bandipora","Baramulla","Budgam","Doda","Ganderbal","Jammu","Kargil","Kathua","Kishtwar","Kulgam","Kupwara","Leh","Poonch","Pulwama","Rajouri","Ramban","Reasi","Samba","Shopian","Srinagar","Udhampur"];
var Jharkhand = ["Bokaro","Chatra","Deoghar","Dhanbad","Dumka","East Singhbhum","Garhwa","Giridih","Godda","Gumla","Hazaribagh","Jamtara","Khunti","Koderma","Latehar","Lohardaga","Pakur","Palamu","Ramgarh","Ranchi","Sahebganj","Seraikela Kharsawan","Simdega","West Singhbhum"];
var Karnataka = ["Bagalkot","Bangalore Rural","Bangalore Urban","Belgaum","Bellary","Bidar","Vijayapura","Chamarajanagar","Chikkaballapur","Chikkamagaluru","Chitradurga","Dakshina Kannada","Davanagere","Dharwad","Gadag","Gulbarga","Hassan","Haveri","Kodagu","Kolar","Koppal","Mandya","Mysore","Raichur","Ramanagara","Shimoga","Tumkur","Udupi","Uttara Kannada","Yadgir"];
var Kerala = ["Alappuzha","Ernakulam","Idukki","Kannur","Kasaragod","Kollam","Kottayam","Kozhikode","Malappuram","Palakkad","Pathanamthitta","Thiruvananthapuram","Thrissur","Wayanad"];
var MadhyaPradesh = ["Agar Malwa","Alirajpur","Anuppur","Ashoknagar","Balaghat","Barwani","Betul","Bhind","Bhopal","Burhanpur","Chhatarpur","Chhindwara","Damoh","Datia","Dewas","Dhar","Dindori","Guna","Gwalior","Harda","Hoshangabad","Indore","Jabalpur","Jhabua","Katni","Khandwa","Khargone","Mandla","Mandsaur","Morena","Narsinghpur","Neemuch","Panna","Raisen","Rajgarh","Ratlam","Rewa","Sagar","Satna",
"Sehore","Seoni","Shahdol","Shajapur","Sheopur","Shivpuri","Sidhi","Singrauli","Tikamgarh","Ujjain","Umaria","Vidisha"];
var Maharashtra = ["Ahmednagar","Akola","Amravati","Aurangabad","Beed","Bhandara","Buldhana","Chandrapur","Dhule","Gadchiroli","Gondia","Hingoli","Jalgaon","Jalna","Kolhapur","Latur","Mumbai City","Mumbai Suburban","Nagpur","Nanded","Nandurbar","Nashik","Osmanabad","Palghar","Parbhani","Pune","Raigad","Ratnagiri","Sangli","Satara","Sindhudurg","Solapur","Thane","Wardha","Washim","Yavatmal"];
var Manipur = ["Bishnupur","Chandel","Churachandpur","Imphal East","Imphal West","Jiribam","Kakching","Kamjong","Kangpokpi","Noney","Pherzawl","Senapati","Tamenglong","Tengnoupal","Thoubal","Ukhrul"];
var Meghalaya = ["East Garo Hills","East Jaintia Hills","East Khasi Hills","North Garo Hills","Ri Bhoi","South Garo Hills","South West Garo Hills","South West Khasi Hills","West Garo Hills","West Jaintia Hills","West Khasi Hills"];
var Mizoram = ["Aizawl","Champhai","Kolasib","Lawngtlai","Lunglei","Mamit","Saiha","Serchhip","Aizawl","Champhai","Kolasib","Lawngtlai","Lunglei","Mamit","Saiha","Serchhip"];
var Nagaland = ["Dimapur","Kiphire","Kohima","Longleng","Mokokchung","Mon","Peren","Phek","Tuensang","Wokha","Zunheboto"];
var Odisha = ["Angul","Balangir","Balasore","Bargarh","Bhadrak","Boudh","Cuttack","Debagarh","Dhenkanal","Gajapati","Ganjam","Jagatsinghpur","Jajpur","Jharsuguda","Kalahandi","Kandhamal","Kendrapara","Kendujhar","Khordha","Koraput","Malkangiri","Mayurbhanj","Nabarangpur","Nayagarh","Nuapada","Puri","Rayagada","Sambalpur","Subarnapur","Sundergarh"];
var Punjab = ["Amritsar","Barnala","Bathinda","Faridkot","Fatehgarh Sahib","Fazilka","Firozpur","Gurdaspur","Hoshiarpur","Jalandhar","Kapurthala","Ludhiana","Mansa","Moga","Mohali","Muktsar","Pathankot","Patiala","Rupnagar","Sangrur","Shaheed Bhagat Singh Nagar","Tarn Taran"];
var Rajasthan = ["Ajmer","Alwar","Banswara","Baran","Barmer","Bharatpur","Bhilwara","Bikaner","Bundi","Chittorgarh","Churu","Dausa","Dholpur","Dungarpur","Ganganagar","Hanumangarh","Jaipur","Jaisalmer","Jalore","Jhalawar","Jhunjhunu","Jodhpur","Karauli","Kota","Nagaur","Pali","Pratapgarh","Rajsamand","Sawai Madhopur","Sikar","Sirohi","Tonk","Udaipur"];
var Sikkim = ["East Sikkim","North Sikkim","South Sikkim","West Sikkim"];
var TamilNadu = ["Ariyalur","Chennai","Coimbatore","Cuddalore","Dharmapuri","Dindigul","Erode","Kanchipuram","Kanyakumari","Karur","Krishnagiri","Madurai","Nagapattinam","Namakkal","Nilgiris","Perambalur","Pudukkottai","Ramanathapuram","Salem","Sivaganga","Thanjavur","Theni","Thoothukudi","Tiruchirappalli","Tirunelveli","Tiruppur","Tiruvallur","Tiruvannamalai","Tiruvarur","Vellore","Viluppuram","Virudhunagar"];
var Telangana = ["Adilabad","Bhadradri Kothagudem","Hyderabad","Jagtial","Jangaon","Jayashankar","Jogulamba","Kamareddy","Karimnagar","Khammam","Komaram Bheem","Mahabubabad","Mahbubnagar","Mancherial","Medak","Medchal","Nagarkurnool","Nalgonda","Nirmal","Nizamabad","Peddapalli","Rajanna Sircilla","Ranga Reddy","Sangareddy","Siddipet","Suryapet","Vikarabad","Wanaparthy","Warangal Rural","Warangal Urban","Yadadri Bhuvanagiri"];
var Tripura = ["Dhalai","Gomati","Khowai","North Tripura","Sepahijala","South Tripura","Unakoti","West Tripura"];
var UttarPradesh = ["Agra","Aligarh","Allahabad","Ambedkar Nagar","Amethi","Amroha","Auraiya","Azamgarh","Baghpat","Bahraich","Ballia","Balrampur","Banda","Barabanki","Bareilly","Basti","Bhadohi","Bijnor","Budaun","Bulandshahr","Chandauli","Chitrakoot","Deoria","Etah","Etawah","Faizabad","Farrukhabad","Fatehpur","Firozabad","Gautam Buddha Nagar","Ghaziabad","Ghazipur","Gonda","Gorakhpur","Hamirpur","Hapur","Hardoi","Hathras","Jalaun","Jaunpur","Jhansi","Kannauj","Kanpur Dehat","Kanpur Nagar","Kasganj","Kaushambi","Kheri","Kushinagar","Lalitpur","Lucknow","Maharajganj","Mahoba","Mainpuri","Mathura","Mau","Meerut","Mirzapur","Moradabad","Muzaffarnagar","Pilibhit","Pratapgarh","Raebareli","Rampur","Saharanpur","Sambhal","Sant Kabir Nagar","Shahjahanpur","Shamli","Shravasti","Siddharthnagar","Sitapur","Sonbhadra","Sultanpur","Unnao","Varanasi"];
var Uttarakhand  = ["Almora","Bageshwar","Chamoli","Champawat","Dehradun","Haridwar","Nainital","Pauri","Pithoragarh","Rudraprayag","Tehri","Udham Singh Nagar","Uttarkashi"];
var WestBengal = ["Alipurduar","Bankura","Birbhum","Cooch Behar","Dakshin Dinajpur","Darjeeling","Hooghly","Howrah","Jalpaiguri","Jhargram","Kalimpong","Kolkata","Malda","Murshidabad","Nadia","North 24 Parganas","Paschim Bardhaman","Paschim Medinipur","Purba Bardhaman","Purba Medinipur","Purulia","South 24 Parganas","Uttar Dinajpur"];
var AndamanNicobar = ["Nicobar","North Middle Andaman","South Andaman"];
var Chandigarh = ["Chandigarh"];
var DadraHaveli = ["Dadra Nagar Haveli"];
var DamanDiu = ["Daman","Diu"];
var Delhi = ["Central Delhi","East Delhi","New Delhi","North Delhi","North East Delhi","North West Delhi","Shahdara","South Delhi","South East Delhi","South West Delhi","West Delhi"];
var Lakshadweep = ["Lakshadweep"];
var Puducherry = ["Karaikal","Mahe","Puducherry","Yanam"];


$("#inputState").change(function(){
  var StateSelected = $(this).val();
  var optionsList;
  var htmlString = "";

  switch (StateSelected) {
    case "Andra Pradesh":
        optionsList = AndraPradesh;
        break;
    case "Arunachal Pradesh":
        optionsList = ArunachalPradesh;
        break;
    case "Assam":
        optionsList = Assam;
        break;
    case "Bihar":
        optionsList = Bihar;
        break;
    case "Chhattisgarh":
        optionsList = Chhattisgarh;
        break;
    case "Goa":
        optionsList = Goa;
        break;
    case  "Gujarat":
        optionsList = Gujarat;
        break;
    case "Haryana":
        optionsList = Haryana;
        break;
    case "Himachal Pradesh":
        optionsList = HimachalPradesh;
        break;
    case "Jammu and Kashmir":
        optionsList = JammuKashmir;
        break;
    case "Jharkhand":
        optionsList = Jharkhand;
        break;
    case  "Karnataka":
        optionsList = Karnataka;
        break;
    case "Kerala":
        optionsList = Kerala;
        break;
    case  "Madya Pradesh":
        optionsList = MadhyaPradesh;
        break;
    case "Maharashtra":
        optionsList = Maharashtra;
        break;
    case  "Manipur":
        optionsList = Manipur;
        break;
    case "Meghalaya":
        optionsList = Meghalaya ;
        break;
    case  "Mizoram":
        optionsList = Mizoram;
        break;
    case "Nagaland":
        optionsList = Nagaland;
        break;
    case  "Orissa":
        optionsList = Orissa;
        break;
    case "Punjab":
        optionsList = Punjab;
        break;
    case  "Rajasthan":
        optionsList = Rajasthan;
        break;
    case "Sikkim":
        optionsList = Sikkim;
        break;
    case  "Tamil Nadu":
        optionsList = TamilNadu;
        break;
    case  "Telangana":
        optionsList = Telangana;
        break;
    case "Tripura":
        optionsList = Tripura ;
        break;
    case  "Uttaranchal":
        optionsList = Uttaranchal;
        break;
    case  "Uttar Pradesh":
        optionsList = UttarPradesh;
        break;
    case "West Bengal":
        optionsList = WestBengal;
        break;
    case  "Andaman and Nicobar Islands":
        optionsList = AndamanNicobar;
        break;
    case "Chandigarh":
        optionsList = Chandigarh;
        break;
    case  "Dadar and Nagar Haveli":
        optionsList = DadraHaveli;
        break;
    case "Daman and Diu":
        optionsList = DamanDiu;
        break;
    case  "Delhi":
        optionsList = Delhi;
        break;
    case "Lakshadeep":
        optionsList = Lakshadeep ;
        break;
    case  "Pondicherry":
        optionsList = Pondicherry;
        break;
}


  for(var i = 0; i < optionsList.length; i++){
    htmlString = htmlString+"<option value='"+ optionsList[i] +"'>"+ optionsList[i] +"</option>";
  }
  $("#inputDistrict").html(htmlString);

});

function toggleDropdown() {
    var dropdownMenu = document.getElementById("innovationsDropdownMenu");
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    if (viewportWidth <= 768) {
        if (dropdownMenu.style.display === "block") {
            dropdownMenu.style.display = "none";
        } else {
            dropdownMenu.style.display = "block";
        }
    }
}

function toggleDropdown2() {
    var dropdownMenu = document.getElementById("productDropdownMenu");
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    if (viewportWidth <= 768) {
        if (dropdownMenu.style.display === "block") {
            dropdownMenu.style.display = "none";
        } else {
            dropdownMenu.style.display = "block";
        }
    }
}

const searchIcon = document.getElementById('search-icon');
const searchInput = document.getElementById('search-input');
const autocomplete = document.getElementById('autocomplete');
const searchMessage = document.getElementById('search-message');
const products = [
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

searchIcon.addEventListener('click', function() {
searchInput.focus();
});

searchInput.addEventListener('input', function() {
const searchTerm = searchInput.value.toLowerCase();
const matchedProducts = products.filter(product => product.name.toLowerCase().includes(searchTerm));

if (matchedProducts.length > 0) {
const autocompleteOptions = matchedProducts.map(product => `
    <div class="autocomplete-item">
        <img src="${product.icon}" alt="${product.name}" class="autocomplete-icon" />
        <span class="autocomplete-name">${product.name}</span>
    </div>
`).join('');
autocomplete.innerHTML = autocompleteOptions;
autocomplete.style.display = 'block';
} else {
autocomplete.innerHTML = '';
autocomplete.style.display = 'none';
}

if (searchInput.value.trim() === '') {
searchMessage.textContent = '';
}
});

searchInput.addEventListener('keydown', function(event) {
if (event.key === 'Enter') {
event.preventDefault();
const searchTerm = searchInput.value.toLowerCase();
const matchedProduct = products.find(product => product.name.toLowerCase() === searchTerm);
if (matchedProduct) {
    window.location.href = matchedProduct.url;
} else {
    searchMessage.textContent = "Product not found.";
}
}
});

document.addEventListener('click', function(event) {
if (!searchInput.contains(event.target)) {
autocomplete.style.display = 'none';
}
});

autocomplete.addEventListener('click', function(event) {
const selectedProduct = event.target.textContent;
const matchedProduct = products.find(product => product.name === selectedProduct);
if (matchedProduct) {
window.location.href = matchedProduct.url;
}
});

window.addEventListener('scroll', function () {
    var scrollPosition = window.scrollY;
    var dropdownIcons = document.querySelectorAll('.ml-12.xl\\:ml-40, .ml-12.xl\\:ml-15.pl-15.relative.group ');

    // Adjust the scroll position value as needed
    if (scrollPosition > 150) { // Example threshold of 150 pixels
        for (var i = 0; i < dropdownIcons.length; i++) {
            dropdownIcons[i].style.opacity = '0';
        }
    } else {
        for (var i = 0; i < dropdownIcons.length; i++) {
            dropdownIcons[i].style.opacity = '1'; // Show the icons again if scroll position is below the threshold
        }
    }
});













