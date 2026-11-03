<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;
use PHPMailer\PHPMailer\SMTP;

// Include PHPMailer library
require 'PHPMailer\src\Exception.php';
require 'PHPMailer\src\PHPMailer.php';
require 'PHPMailer\src\SMTP.php';


// Check if the form is submitted
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Get form data
    $name = $_POST['name'];
    $email = $_POST['email'];
    $website = $_POST['website'];
    $phone = $_POST['phone'];
    $message = $_POST['message'];

    // Create a new PHPMailer instance
    $mail = new PHPMailer(true);

    try {
        // Set SMTP configuration
        $mail->isSMTP();
        $mail->Host = 'smtp-relay.brevo.com'; // Replace with your SMTP server address
        $mail->SMTPAuth = true;
        $mail->Username = getenv('SMTP_USERNAME');
        $mail->Password = getenv('SMTP_PASSWORD');
        $mail->SMTPSecure = 'tls'; // Options: 'ssl' (deprecated) or 'tls'
        $mail->Port = 587; // TCP port to connect to, use 465 for 'ssl'

        // Set email content and recipient
        $mail->setFrom($email); // Set sender's email and name
        $mail->addAddress('info@agross.in'); // Add recipient email and name

        $mail->isHTML(true);
        $mail->Subject = 'Contact Us Request';
        $mail->Body = "
            <h3>Contact Us Request</h3>
            <p><strong>Name:</strong> $name</p>
            <p><strong>Email:</strong> $email</p>
            <p><strong>Phone No:</strong> $phone</p>
            <p><strong>Website:</strong> $website</p>
            <p><strong>Message:</strong> $message</p>
        ";

        $mail->send();

        // Redirect to thank you page
        header('Location:  https://agross.in/thankyou.html');
        exit;

    } catch (Exception $e) {
        echo "Email could not be sent. Error: {$mail->ErrorInfo}";
    }
}
?>