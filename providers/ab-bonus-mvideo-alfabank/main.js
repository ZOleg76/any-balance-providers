/**
Провайдер AnyBalance (http://any-balance-providers.googlecode.com)
*/

var g_headers = {
	'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Charset': 'windows-1251,utf-8;q=0.7,*;q=0.3',
	'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.6,en;q=0.4',
	'Cache-Control': 'max-age=0',
	'Connection': 'keep-alive',
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.155 Safari/537.36',
};

var baseurl = 'https://www.mvideo.ru';
var baseurl1 = 'http://www.mvideo.ru';

function login(){
	var prefs = AnyBalance.getPreferences();

    if(!prefs.type)
    	prefs.type = '0';
    
    if(prefs.type != '-1'){
    	// Проверяем правильность ввода даты рождения
    	checkEmpty(prefs.card, 'Введите номер карты!');
    	checkEmpty(prefs.zip, 'Введите zip-код карты!');
        var matches = /^(\d{2})[^\d](\d{2})[^\d](\d{4})$/i.exec('' + prefs.birthday);
        if (!matches)
			throw new AnyBalance.Error('День рождения должен быть в формате DD-MM-YYYY, например, 28-04-1980');
			
        var birthdate = prefs.birthday.replace(/[^\d]/g, '.');
    }else{
		checkEmpty(prefs.login, 'Введите логин!');
		checkEmpty(prefs.password, 'Введите пароль!');
    }

    var html = AnyBalance.requestGet(baseurl1 + '/', g_headers);
    html = AnyBalance.requestGet(baseurl + '/login', addHeaders({Referer: baseurl1 + '/'}));
    var form = getElement(html, prefs.type == '-1' ? /<form[^>]+id="login-form"[^>]*>/i : /<form[^>]+id="login-bonus-card-form"[^>]*>/i);
    if(!form){
    	AnyBalance.trace(form);
    	throw new AnyBalance.Error('Не удалось найти форму входа. Сайт изменен?');
    }

    var allowedArgs = /_dyn|cardType|CardNumber|zipCode|dateOfBirth|loginCard|DARGS|loginCaseSensitive|password|loginEmailPhone/i;
	var params = createFormParams(form, function(params, str, name, value) {
		if(!allowedArgs.test(name))
			return;

		if (name == 'mvideoBonusCardNumber' && prefs.type == '0') 
			return prefs.card;
		else if (name == 'alfaCardNumber' && prefs.type == '1') 
			return prefs.card;
		else if (name == 'cetelemCardNumber' && prefs.type == '2') 
			return prefs.card;
		else if (/cardType/i.test(name))
			return {'0': 'mvidCard', '1': 'alphaCard', '2': 'cetelemCard'}[prefs.type];
		else if ('/com/mvideo/userprofiling/LoginFormHandler.loginCaseSensitive' == name)
			return prefs.login;
		else if ('password' == name)
			return prefs.password;
		else if (name == 'zipCode')
			return prefs.zip;
		else if (name == '/com/mvideo/userprofiling/LoginFormHandler.dateOfBirth')
			return birthdate;

		return value;
	});

	var action = getParam(form, null, null, /action="([^"]*)/i, replaceHtmlEntities);
	html = AnyBalance.requestPost(baseurl + action, params, addHeaders({Referer: baseurl + '/login'}));

	if(!/logout/i.test(html)){
		if(/Мы ввели обязательное подтверждение телефона/i.test(html))
			throw new AnyBalance.Error('МВидео требует подтвердить ваш номер телефона. Зайдите в личный кабинет через браузер.');
		var error = getParam(html, null, null, /<label[^>]+class="text-error"[^>]*>\s*([^\s<][\s\S]*?)<\/label>/ig, replaceTagsAndSpaces);
		if(error)
			throw new AnyBalance.Error(error, null, /Неверный логин или пароль/i.test(error));
		if(!html && prefs.type >= 0)
			throw new AnyBalance.Error('Не удаётся зайти по номеру карты (М.Видео возвращает пустую страницу). Попробуйте войти по логину и паролю.');
		if(/Для восстановления пароля авторизуйтесь через адрес электронной почты или телефон/i.test(html))
			throw new AnyBalance.Error('М.Видео требует ввести пароль в личный кабинет. Вам необходимо войти в личный кабинет М.Видео https://www.mvideo.ru/login через браузер и ввести пароль.');
		AnyBalance.trace(html);
		throw new AnyBalance.Error('Не удалось зайти в личный кабинет. Сайт изменен?');
			
	}

	return html;
}

function main(){
    var prefs = AnyBalance.getPreferences();
    AnyBalance.setDefaultCharset('utf-8');
    AnyBalance.setOptions({cookiePolicy: 'netscape'});

    var html;
    try{
        html = login();
    }catch(e){
    	if(prefs.type != '-1' && prefs.login && prefs.password){
    		AnyBalance.trace('Войти по карте не удалось: ' + e.message + ', пробуем по логину-паролю');
    		prefs.type = '-1';
    		html = login();
    	}else{
    		throw e;
    	}
    }

	var result = {success: true};
    //Баланс бонусных рублей
    getParam(html, result, 'balance_all', /<span[^>]+class="header-user-details"[^>]*>([\s\S]*?)<\/span>/i, replaceTagsAndSpaces, parseBalance);

    html = AnyBalance.requestGet(baseurl + '/my-account', g_headers);
    getParam(html, result, 'fio', /Владелец карты[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i, replaceTagsAndSpaces);
    getParam(html, result, 'balance', /<div[^>]+my-account-block-bonus-rubles-title[^>]*>([\s\S]*?)<\/span>/i, replaceTagsAndSpaces, parseBalance);
    getParam(html, result, '__tariff', /Номер карты[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i, replaceTagsAndSpaces);
    
    var hist = getElement(html, /<li[^>]+personal-orders-block-item[^>]*>/i);
    if(hist){
    	// Дата последней операции по счету
   		getParam(hist, result, 'last_date2', /<div[^>]+order-date[^>]*>([\s\S]*?)<\/div>/i, replaceTagsAndSpaces, parseDate);
   		getParam(hist, result, 'last_number', /<div[^>]+number[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i, replaceTagsAndSpaces);
   		getParam(hist, result, 'last_status', /<div[^>]+status[^>]*>([\s\S]*?)<\/div>/i, [/<strong[^>]*>[\s\S]*?<\/strong>/i, '', replaceTagsAndSpaces]);
    	getParam(hist, result, 'last_sum', /<div[^>]+amount[^>]*>([\s\S]*?)<\/div>/i, replaceTagsAndSpaces, parseBalance);
    }else{
    	AnyBalance.trace('Последняя операция не найдена...');
    }

    if(AnyBalance.isAvailable('burn_date2')){
    	var tri = 0;
    	do{
	    	if(tri)
	    		AnyBalance.trace('Попытка №' + (tri+1) + ' получить время устаревания бонусов');
	    	html = AnyBalance.requestGet(baseurl1 + '/my-account/loyalty?ssb_block=balansBonusCardTabContentBlock&ajax=true&_=' + new Date().getTime(), addHeaders({
	    		Referer: baseurl + '/my-account/loyalty',
	    		'X-Requested-With':'XMLHttpRequest'
	    	}));
	    	++tri;
	    }while(html.length < 3 && tri < 5);
    	//Даты сгорания бонусных рублей
	    sumParam(html, result, 'burn_date2', /<td[^>]+balans-table-cell-1[^>]*>([\s\S]*?)<\/td>/ig, replaceTagsAndSpaces, parseDate, aggregate_min);
	    if(AnyBalance.isAvailable('burn_date2') && !isset(result.burn_date2))
	    	AnyBalance.trace('Не удалось получить дату сгорания: ' + html);
	}

    if(AnyBalance.isAvailable('strategy')){
   	   	html = AnyBalance.requestGet(baseurl1 + '/my-account/bonusStrategy', g_headers);
   	   	var checked = getElements(html, [/<div[^>]+class="controls-group"[^>]*>/ig, /<input[^>]+id="newsletterBySms[^>]+checked/i])[0];
   	   	if(!checked)
   	   		AnyBalance.trace('Стратегия не выбрана?\n' + html); 
   	   	getParam(checked, result, 'strategy', null, replaceTagsAndSpaces, html_entity_decode);
   	}

    AnyBalance.setResult(result);
}

function addzero(i) {
	return (i < 10) ? "0" + i : i;
}

function format_date(d, format) {
	var m;
	if (d[4] + d[5] == "01") {
		m = "янв";
	}
	if (d[4] + d[5] == "02") {
		m = "фев";
	}
	if (d[4] + d[5] == "03") {
		m = "мар";
	}
	if (d[4] + d[5] == "04") {
		m = "апр";
	}
	if (d[4] + d[5] == "05") {
		m = "май";
	}
	if (d[4] + d[5] == "06") {
		m = "июн";
	}
	if (d[4] + d[5] == "07") {
		m = "июл";
	}
	if (d[4] + d[5] == "08") {
		m = "авг";
	}
	if (d[4] + d[5] == "09") {
		m = "сен";
	}
	if (d[4] + d[5] == "10") {
		m = "окт";
	}
	if (d[4] + d[5] == "11") {
		m = "ноя";
	}
	if (d[4] + d[5] == "12") {
		m = "дек";
	}
	if (format == 1) {
		d = d[0] + d[1] + d[2] + d[3] + ' ' + m + ' ' + d[6] + d[7];
	} //          YYYY MMM DD
	if (format == 2) {
		d = d[6] + d[7] + ' ' + m + ' ' + d[0] + d[1] + d[2] + d[3];
	} //          DD MMM YYYY
	if (format == 3) {
		d = d[0] + d[1] + d[2] + d[3] + '-' + d[4] + d[5] + '-' + d[6] + d[7];
	} //          YYYY-MM-DD
	if (format == 4) {
		d = d[6] + d[7] + '-' + d[4] + d[5] + '-' + d[0] + d[1] + d[2] + d[3];
	} //          DD-MM-YYYY
	return d;
}